// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_decode_session.hpp"

extern "C" {
#include <libavutil/error.h>
#include <libavutil/hwcontext.h>
}

#include <algorithm>
#include <array>
#include <utility>

namespace framescaper::media {
namespace {

[[nodiscard]] std::string ffmpeg_error(const int code) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> bytes{};
	av_strerror(code, bytes.data(), bytes.size());
	return std::string{bytes.data()};
}

void require(const int status, const std::string& action, const bool hardware = false) {
	if (status >= 0) return;
	throw ffmpeg_decode_failure(
		hardware ? "hardware-backend-failed" : "ffmpeg-operation-failed",
		action + ": " + ffmpeg_error(status), hardware ? 78 : 70
	);
}

[[nodiscard]] AVHWDeviceType device_type(const std::string& backend) noexcept {
#if defined(_WIN32)
	if (backend == "d3d11va" || backend == "media-foundation" || backend == "amf") {
		return AV_HWDEVICE_TYPE_D3D11VA;
	}
#elif defined(__APPLE__)
	if (backend == "videotoolbox") return AV_HWDEVICE_TYPE_VIDEOTOOLBOX;
#else
	if (backend == "vaapi") return AV_HWDEVICE_TYPE_VAAPI;
	if (backend == "amf") return AV_HWDEVICE_TYPE_VULKAN;
#endif
	if (backend == "qsv") return AV_HWDEVICE_TYPE_QSV;
	if (backend == "nvdec" || backend == "nvenc") return AV_HWDEVICE_TYPE_CUDA;
	return AV_HWDEVICE_TYPE_NONE;
}

} // namespace

struct ffmpeg_decode_session::hardware_state final {
	AVBufferRef* device{};
	AVPixelFormat pixel_format{AV_PIX_FMT_NONE};
	~hardware_state() { av_buffer_unref(&device); }
};

ffmpeg_decode_failure::ffmpeg_decode_failure(
	std::string code,
	std::string message,
	const int exit_code
) : std::runtime_error(std::move(message)), code_{std::move(code)}, exit_code_{exit_code} {}

const std::string& ffmpeg_decode_failure::code() const noexcept { return code_; }
int ffmpeg_decode_failure::exit_code() const noexcept { return exit_code_; }

bool ffmpeg_backend_is_hardware(const std::string& backend) noexcept {
	return backend != "native-cpu" && device_type(backend) != AV_HWDEVICE_TYPE_NONE;
}

ffmpeg_decode_session::ffmpeg_decode_session(ffmpeg_decode_session&& other) noexcept
	: format{std::exchange(other.format, nullptr)}, codec{std::exchange(other.codec, nullptr)},
	stream_index{std::exchange(other.stream_index, -1)},
	packet_{std::exchange(other.packet_, nullptr)}, frame_{std::exchange(other.frame_, nullptr)},
	transferred_{std::exchange(other.transferred_, nullptr)},
	hardware_{std::exchange(other.hardware_, nullptr)} {
	if (codec != nullptr && hardware_ != nullptr) codec->opaque = hardware_;
}

ffmpeg_decode_session::~ffmpeg_decode_session() {
	delete hardware_;
	av_frame_free(&transferred_);
	av_frame_free(&frame_);
	av_packet_free(&packet_);
	avcodec_free_context(&codec);
	avformat_close_input(&format);
}

ffmpeg_decode_session ffmpeg_decode_session::open(
	const std::filesystem::path& path,
	const std::string& backend,
	int (*interrupt)(void*)
) {
	ffmpeg_decode_session session;
	session.format = avformat_alloc_context();
	if (session.format == nullptr) {
		throw ffmpeg_decode_failure("decode-allocation", "The input context cannot be allocated.");
	}
	if (interrupt != nullptr) session.format->interrupt_callback = AVIOInterruptCB{interrupt, nullptr};
	AVDictionary* options = nullptr;
	av_dict_set(&options, "protocol_whitelist", "file", 0);
	av_dict_set(&options, "format_whitelist",
		"mov,matroska,webm,avi,mpegts,mpeg,ogg,wav,flac,png_pipe,tiff_pipe,exr_pipe,mjpeg,jpeg_pipe,mxf", 0);
	const auto path_text = path.string();
	auto status = avformat_open_input(&session.format, path_text.c_str(), nullptr, &options);
	av_dict_free(&options);
	require(status, "Open the authenticated source");
	require(avformat_find_stream_info(session.format, nullptr), "Read source stream information");
	const AVCodec* decoder = nullptr;
	session.stream_index = av_find_best_stream(
		session.format, AVMEDIA_TYPE_VIDEO, -1, -1, &decoder, 0
	);
	if (session.stream_index < 0 || decoder == nullptr) {
		throw ffmpeg_decode_failure(
			"video-stream-missing", "The authenticated source has no supported video stream.", 65
		);
	}
	session.codec = avcodec_alloc_context3(decoder);
	if (session.codec == nullptr) {
		throw ffmpeg_decode_failure("decode-allocation", "The decoder context cannot be allocated.");
	}
	require(avcodec_parameters_to_context(
		session.codec, session.format->streams[session.stream_index]->codecpar
	), "Copy decoder parameters");
	session.codec->thread_count = backend == "native-cpu" ? 0 : 1;
	if (backend != "native-cpu") {
		const auto type = device_type(backend);
		if (type == AV_HWDEVICE_TYPE_NONE) {
			throw ffmpeg_decode_failure(
				"hardware-backend-unavailable", "The requested hardware backend is unavailable on this target.", 78
			);
		}
		auto* state = new hardware_state{};
		session.hardware_ = state;
		require(av_hwdevice_ctx_create(&state->device, type, nullptr, nullptr, 0),
			"Create the authenticated hardware decode device", true);
		for (int index = 0;; ++index) {
			const AVCodecHWConfig* config = avcodec_get_hw_config(decoder, index);
			if (config == nullptr) break;
			if ((config->methods & AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX) != 0
				&& config->device_type == type) {
				state->pixel_format = config->pix_fmt;
				break;
			}
		}
		if (state->pixel_format == AV_PIX_FMT_NONE) {
			throw ffmpeg_decode_failure(
				"hardware-backend-unavailable", "The source decoder has no matching hardware configuration.", 78
			);
		}
		session.codec->opaque = state;
		session.codec->get_format = select_hardware_format;
		session.codec->hw_device_ctx = av_buffer_ref(state->device);
		if (session.codec->hw_device_ctx == nullptr) {
			throw ffmpeg_decode_failure("decode-allocation", "The hardware decoder device reference cannot be allocated.");
		}
	}
	require(avcodec_open2(session.codec, decoder, nullptr),
		backend == "native-cpu" ? "Open the CPU decoder" : "Open the hardware decoder",
		backend != "native-cpu");
	session.packet_ = av_packet_alloc();
	session.frame_ = av_frame_alloc();
	session.transferred_ = av_frame_alloc();
	if (session.packet_ == nullptr || session.frame_ == nullptr || session.transferred_ == nullptr) {
		throw ffmpeg_decode_failure("decode-allocation", "Decode frame storage cannot be allocated.");
	}
	return session;
}

AVPixelFormat ffmpeg_decode_session::select_hardware_format(
	AVCodecContext* context,
	const AVPixelFormat* formats
) {
	const auto* state = static_cast<const hardware_state*>(context->opaque);
	if (state == nullptr) return AV_PIX_FMT_NONE;
	for (const AVPixelFormat* candidate = formats; *candidate != AV_PIX_FMT_NONE; ++candidate) {
		if (*candidate == state->pixel_format) return *candidate;
	}
	return AV_PIX_FMT_NONE;
}

bool ffmpeg_decode_session::hardware() const noexcept { return hardware_ != nullptr; }

AVFrame* ffmpeg_decode_session::software_frame() {
	if (hardware_ == nullptr) return frame_;
	if (frame_->format != hardware_->pixel_format) {
		throw ffmpeg_decode_failure(
			"hardware-backend-failed", "The decoder silently returned a software frame for a hardware attempt.", 78
		);
	}
	av_frame_unref(transferred_);
	require(av_hwframe_transfer_data(transferred_, frame_, 0),
		"Download one authenticated hardware frame", true);
	require(av_frame_copy_props(transferred_, frame_), "Copy hardware frame properties", true);
	return transferred_;
}

void ffmpeg_decode_session::drain(const std::function<void(AVFrame*)>& consume) {
	while (true) {
		const auto status = avcodec_receive_frame(codec, frame_);
		if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) return;
		require(status, hardware_ == nullptr ? "Receive a decoded frame" : "Receive a hardware decoded frame",
			hardware_ != nullptr);
		consume(software_frame());
		av_frame_unref(frame_);
	}
}

void ffmpeg_decode_session::decode_all(const std::function<void(AVFrame*)>& consume) {
	while (true) {
		const auto read = av_read_frame(format, packet_);
		if (read == AVERROR_EOF) break;
		require(read, "Read an authenticated source packet", hardware_ != nullptr);
		if (packet_->stream_index == stream_index) {
			const auto sent = avcodec_send_packet(codec, packet_);
			av_packet_unref(packet_);
			require(sent, "Send a source packet to the decoder", hardware_ != nullptr);
			drain(consume);
		} else av_packet_unref(packet_);
	}
	require(avcodec_send_packet(codec, nullptr), "Flush the source decoder", hardware_ != nullptr);
	drain(consume);
}

} // namespace framescaper::media
