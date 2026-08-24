// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_hardware_encode.hpp"

extern "C" {
#include <libavutil/error.h>
#include <libavutil/hwcontext.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>
}

#include <array>
#include <string_view>
#include <utility>

namespace framescaper::media {
namespace {

struct encode_binding final {
	std::string encoder;
	AVHWDeviceType device_type{AV_HWDEVICE_TYPE_NONE};
	std::string upload_pixel_format;
	bool hardware{};
	bool require_hardware_frames{};
	bool forbid_software_fallback{};
};

[[nodiscard]] std::string error_text(const int code) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> bytes{};
	av_strerror(code, bytes.data(), bytes.size());
	return std::string{bytes.data()};
}

[[noreturn]] void fail(
	const bool hardware,
	const std::string_view action,
	const int status,
	const std::string_view code = "ffmpeg-operation-failed"
) {
	const auto resolved_code = code != "ffmpeg-operation-failed"
		? std::string{code}
		: hardware ? std::string{"hardware-encoder-failed"} : std::string{code};
	throw ffmpeg_encode_failure(
		resolved_code,
		std::string{action} + (status < 0 ? ": " + error_text(status) : ""),
		hardware ? 78 : 70
	);
}

void require(const int status, const bool hardware, const std::string_view action) {
	if (status < 0) fail(hardware, action, status);
}

[[nodiscard]] AVPixelFormat pixel_format(const std::string_view name, const bool hardware) {
	const auto value = av_get_pix_fmt(std::string{name}.c_str());
	if (value == AV_PIX_FMT_NONE) fail(
		hardware, "Resolve the exact encoder upload pixel format", AVERROR(EINVAL),
		"pixel-format-policy"
	);
	return value;
}

[[nodiscard]] encode_binding cpu_binding(const admitted_media_plan& plan) {
	return {plan.video_encoder, AV_HWDEVICE_TYPE_NONE, plan.pixel_format, false, false, false};
}

[[nodiscard]] bool h264(const admitted_media_plan& plan) noexcept {
	return plan.video_codec == "h264" && plan.container == "mp4";
}

[[nodiscard]] bool hevc(const admitted_media_plan& plan) noexcept {
	return plan.video_codec == "hevc" && plan.container == "mp4"
		&& plan.pixel_format == "yuv420p10le";
}

[[nodiscard]] bool vp9(const admitted_media_plan& plan) noexcept {
	return plan.video_codec == "vp9" && plan.container == "webm";
}

[[nodiscard]] bool prores(const admitted_media_plan& plan) noexcept {
	return plan.video_codec == "prores" && plan.container == "mov";
}

[[nodiscard]] std::string long_gop_encoder(
	const admitted_media_plan& plan,
	const std::string_view suffix
) {
	if (h264(plan)) return "h264_" + std::string{suffix};
	if (hevc(plan)) return "hevc_" + std::string{suffix};
	if (vp9(plan) && (suffix == "qsv" || suffix == "vaapi")) {
		return "vp9_" + std::string{suffix};
	}
	return {};
}

[[nodiscard]] std::string upload_format(const admitted_media_plan& plan) {
	return hevc(plan) ? "p010le" : prores(plan) ? "yuv422p10le" : "nv12";
}

[[nodiscard]] encode_binding hardware_binding(
	const admitted_media_plan& plan,
	const std::string& backend
) {
	encode_binding result;
	result.hardware = true;
	result.upload_pixel_format = upload_format(plan);
	if (backend == "d3d11va" || backend == "nvdec") {
		fail(true, "A decode-only backend cannot be relabelled as hardware encode", AVERROR(ENOSYS),
			"hardware-encoder-unavailable");
	}
#if defined(_WIN32)
	if (backend == "media-foundation") {
		result.encoder = h264(plan) ? "h264_mf" : hevc(plan) ? "hevc_mf" : "";
		result.device_type = AV_HWDEVICE_TYPE_D3D11VA;
		result.forbid_software_fallback = true;
	} else if (backend == "amf") {
		result.encoder = long_gop_encoder(plan, "amf");
		result.device_type = AV_HWDEVICE_TYPE_D3D11VA;
		result.require_hardware_frames = true;
	}
#elif defined(__APPLE__)
	if (backend == "videotoolbox") {
		result.encoder = h264(plan) ? "h264_videotoolbox"
			: hevc(plan) ? "hevc_videotoolbox"
			: prores(plan) ? "prores_videotoolbox" : "";
		result.device_type = AV_HWDEVICE_TYPE_VIDEOTOOLBOX;
		result.forbid_software_fallback = true;
	}
#else
	if (backend == "vaapi") {
		result.encoder = long_gop_encoder(plan, "vaapi");
		result.device_type = AV_HWDEVICE_TYPE_VAAPI;
		result.require_hardware_frames = true;
	} else if (backend == "amf") {
		result.encoder = long_gop_encoder(plan, "amf");
		result.device_type = AV_HWDEVICE_TYPE_VULKAN;
		result.require_hardware_frames = true;
	}
#endif
#if !defined(__APPLE__)
	if (backend == "qsv") {
		result.encoder = long_gop_encoder(plan, "qsv");
		result.device_type = AV_HWDEVICE_TYPE_QSV;
		result.require_hardware_frames = true;
	} else if (backend == "nvenc") {
		result.encoder = h264(plan) ? "h264_nvenc" : hevc(plan) ? "hevc_nvenc" : "";
		result.device_type = AV_HWDEVICE_TYPE_CUDA;
		result.require_hardware_frames = true;
	}
#endif
	if (result.encoder.empty() || result.device_type == AV_HWDEVICE_TYPE_NONE) {
		fail(true, "The profile has no exact encoder for the requested hardware backend",
			AVERROR(ENOSYS), "hardware-encoder-unavailable");
	}
	return result;
}

[[nodiscard]] encode_binding binding(const admitted_media_plan& plan, const std::string& backend) {
	return backend == "native-cpu" ? cpu_binding(plan) : hardware_binding(plan, backend);
}

void exact_option(
	AVCodecContext* context,
	const bool hardware,
	const std::string_view name,
	const std::string_view value
) {
	const auto status = av_opt_set(
		context->priv_data, std::string{name}.c_str(), std::string{value}.c_str(), 0
	);
	require(status, hardware, "Set exact encoder option " + std::string{name});
}

void configure_cpu_options(
	AVCodecContext* context,
	const admitted_media_plan& plan
) {
	if (plan.video_encoder == "libx264") {
		exact_option(context, false, "preset", plan.quality == "draft" ? "veryfast" : plan.quality == "high" ? "slow" : "medium");
		exact_option(context, false, "crf", plan.quality == "draft" ? "28" : plan.quality == "high" ? "18" : "23");
	} else if (plan.video_encoder == "libx265") {
		exact_option(context, false, "preset", plan.quality == "draft" ? "fast" : plan.quality == "high" ? "slow" : "medium");
		exact_option(context, false, "crf", plan.quality == "draft" ? "26" : plan.quality == "high" ? "16" : "20");
		exact_option(context, false, "profile", "main10");
	} else if (plan.video_encoder == "libvpx-vp9") {
		exact_option(context, false, "deadline", "good");
		exact_option(context, false, "cpu-used", plan.quality == "draft" ? "6" : plan.quality == "high" ? "2" : "4");
		exact_option(context, false, "crf", plan.quality == "draft" ? "36" : plan.quality == "high" ? "24" : "31");
		context->bit_rate = 0;
	} else if (plan.video_encoder == "prores_ks") {
		const auto profile = plan.pixel_format.find("444") != std::string::npos
			? "4444" : plan.quality == "draft" ? "proxy" : "hq";
		exact_option(context, false, "profile", profile);
		context->bits_per_raw_sample = plan.pixel_format.find("444") != std::string::npos ? 12 : 10;
	} else if (plan.video_encoder == "dnxhd") {
		exact_option(context, false, "profile", "dnxhr_hqx");
		context->bits_per_raw_sample = 12;
	} else if (plan.video_encoder == "ffv1") {
		exact_option(context, false, "level", "3");
		exact_option(context, false, "coder", "1");
		exact_option(context, false, "context", "1");
	} else if (plan.video_encoder != "png" && plan.video_encoder != "tiff"
		&& plan.video_encoder != "exr") {
		fail(false, "The CPU encoder is outside the closed professional registry", AVERROR(ENOSYS),
			"codec-policy-unavailable");
	}
}

void configure_hardware_options(
	AVCodecContext* context,
	const encode_binding& selected,
	const std::string& backend
) {
	if (backend == "media-foundation") {
		exact_option(context, true, "hw_encoding", "1");
	} else if (backend == "videotoolbox") {
		exact_option(context, true, "allow_sw", "0");
	} else if (backend == "nvenc") {
		exact_option(context, true, "preset", "p4");
		exact_option(context, true, "tune", "hq");
	} else if (backend == "amf") {
		exact_option(context, true, "usage", "transcoding");
		exact_option(context, true, "quality", "quality");
	} else if (backend == "qsv") {
		exact_option(context, true, "preset", "medium");
	}
	if (selected.forbid_software_fallback && selected.encoder.empty()) {
		fail(true, "The hardware-only encoder selection was lost", AVERROR(EINVAL));
	}
}

[[nodiscard]] const AVCodecHWConfig* hardware_config(
	const AVCodec* codec,
	const AVHWDeviceType type,
	const bool require_frames
) {
	for (int index = 0;; ++index) {
		const auto* config = avcodec_get_hw_config(codec, index);
		if (config == nullptr) break;
		const bool method = require_frames
			? (config->methods & AV_CODEC_HW_CONFIG_METHOD_HW_FRAMES_CTX) != 0
			: (config->methods & (AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX
				| AV_CODEC_HW_CONFIG_METHOD_HW_FRAMES_CTX)) != 0;
		if (method && config->device_type == type) return config;
	}
	return nullptr;
}

} // namespace

struct ffmpeg_video_encode_session::state final {
	AVCodecContext* context{};
	AVBufferRef* device{};
	AVBufferRef* frames{};
	AVFrame* software_frame{};
	AVFrame* hardware_frame{};
	SwsContext* scaler{};
	std::string encoder_name;
	AVPixelFormat upload_format{AV_PIX_FMT_NONE};
	AVPixelFormat hardware_format{AV_PIX_FMT_NONE};
	bool hardware{};
	bool hardware_frames{};
	~state() {
		sws_freeContext(scaler);
		av_frame_free(&hardware_frame);
		av_frame_free(&software_frame);
		av_buffer_unref(&frames);
		av_buffer_unref(&device);
		avcodec_free_context(&context);
	}
};

ffmpeg_encode_failure::ffmpeg_encode_failure(
	std::string code,
	std::string message,
	const int exit_code
) : std::runtime_error(std::move(message)), code_{std::move(code)}, exit_code_{exit_code} {}

const std::string& ffmpeg_encode_failure::code() const noexcept { return code_; }
int ffmpeg_encode_failure::exit_code() const noexcept { return exit_code_; }

ffmpeg_video_encode_session::~ffmpeg_video_encode_session() { delete state_; }

std::unique_ptr<ffmpeg_video_encode_session> ffmpeg_video_encode_session::open(
	const ffmpeg_video_encode_request& request
) {
	auto result = std::unique_ptr<ffmpeg_video_encode_session>{new ffmpeg_video_encode_session{}};
	result->state_ = new state{};
	auto& state = *result->state_;
	const auto selected = binding(request.plan, request.backend);
	state.hardware = selected.hardware;
	state.encoder_name = selected.encoder;
	state.upload_format = pixel_format(selected.upload_pixel_format, selected.hardware);
	const auto* codec = avcodec_find_encoder_by_name(selected.encoder.c_str());
	if (codec == nullptr || codec->name == nullptr || selected.encoder != codec->name) {
		fail(selected.hardware, "Find the exact named encoder", AVERROR_ENCODER_NOT_FOUND,
			selected.hardware ? "hardware-encoder-unavailable" : "codec-policy-unavailable");
	}
	state.context = avcodec_alloc_context3(codec);
	if (state.context == nullptr) fail(selected.hardware, "Allocate the exact encoder", AVERROR(ENOMEM));
	state.context->width = static_cast<int>(request.width);
	state.context->height = static_cast<int>(request.height);
	state.context->time_base = request.time_base;
	state.context->framerate = request.frame_rate;
	state.context->thread_count = 1;
	state.context->gop_size = 12;
	state.context->max_b_frames = 0;
	if (request.plan.professional_profile_id == "encode-hevc-main10-hdr10") {
		state.context->color_primaries = AVCOL_PRI_BT2020;
		state.context->color_trc = AVCOL_TRC_SMPTE2084;
		state.context->colorspace = AVCOL_SPC_BT2020_NCL;
		state.context->color_range = AVCOL_RANGE_MPEG;
	}
	if (request.global_header) state.context->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
	if (selected.hardware) {
		require(av_hwdevice_ctx_create(
			&state.device, selected.device_type, nullptr, nullptr, 0
		), true, "Create the exact hardware encode device");
		const auto* config = hardware_config(codec, selected.device_type, selected.require_hardware_frames);
		if (selected.require_hardware_frames && config == nullptr) fail(true, "The exact encoder has no matching hardware device configuration",
			AVERROR(ENOSYS), "hardware-encoder-unavailable");
		state.context->hw_device_ctx = av_buffer_ref(state.device);
		if (state.context->hw_device_ctx == nullptr) fail(true, "Reference the hardware encode device", AVERROR(ENOMEM));
		state.hardware_frames = selected.require_hardware_frames;
		if (state.hardware_frames) {
			if (config == nullptr) fail(true, "The exact hardware frame configuration disappeared", AVERROR(ENOSYS));
			state.hardware_format = config->pix_fmt;
			state.frames = av_hwframe_ctx_alloc(state.device);
			if (state.frames == nullptr) fail(true, "Allocate the hardware frame pool", AVERROR(ENOMEM));
			auto* frames = reinterpret_cast<AVHWFramesContext*>(state.frames->data);
			frames->format = state.hardware_format;
			frames->sw_format = state.upload_format;
			frames->width = state.context->width;
			frames->height = state.context->height;
			frames->initial_pool_size = 2;
			require(av_hwframe_ctx_init(state.frames), true, "Initialize the exact hardware frame pool");
			state.context->hw_frames_ctx = av_buffer_ref(state.frames);
			if (state.context->hw_frames_ctx == nullptr) fail(true, "Reference the hardware frame pool", AVERROR(ENOMEM));
			state.context->pix_fmt = state.hardware_format;
		} else state.context->pix_fmt = state.upload_format;
		configure_hardware_options(state.context, selected, request.backend);
	} else {
		state.context->pix_fmt = state.upload_format;
		configure_cpu_options(state.context, request.plan);
	}
	require(avcodec_open2(state.context, codec, nullptr), selected.hardware,
		selected.hardware ? "Open the exact hardware encoder" : "Open the exact CPU encoder");
	state.software_frame = av_frame_alloc();
	state.hardware_frame = av_frame_alloc();
	if (state.software_frame == nullptr || state.hardware_frame == nullptr) {
		fail(selected.hardware, "Allocate encoder frame storage", AVERROR(ENOMEM));
	}
	state.software_frame->format = state.upload_format;
	state.software_frame->width = state.context->width;
	state.software_frame->height = state.context->height;
	const auto* upload_descriptor = av_pix_fmt_desc_get(state.upload_format);
	const bool alpha_profile = request.plan.professional_profile_id == "encode-mov-prores-4444"
		|| request.plan.professional_profile_id == "encode-matroska-ffv1"
		|| request.plan.professional_profile_id == "encode-png-sequence"
		|| request.plan.professional_profile_id == "encode-tiff-sequence"
		|| request.plan.professional_profile_id == "encode-openexr-sequence";
	if (alpha_profile && (upload_descriptor == nullptr
		|| (upload_descriptor->flags & AV_PIX_FMT_FLAG_ALPHA) == 0)) {
		fail(selected.hardware, "The exact encoder upload format would drop alpha", AVERROR(EINVAL),
			"alpha-not-preserved");
	}
	require(av_frame_get_buffer(state.software_frame, 32), selected.hardware,
		"Allocate the exact encoder upload frame");
	return result;
}

AVCodecContext* ffmpeg_video_encode_session::context() const noexcept { return state_->context; }
const std::string& ffmpeg_video_encode_session::encoder_name() const noexcept { return state_->encoder_name; }
bool ffmpeg_video_encode_session::hardware() const noexcept { return state_->hardware; }

AVFrame* ffmpeg_video_encode_session::prepare(
	const std::uint8_t* const source_data[4],
	const int source_linesize[4],
	const int source_width,
	const int source_height,
	const AVPixelFormat source_format,
	const std::int64_t pts,
	const std::int64_t duration,
	const AVFrame* source_properties
) {
	auto& state = *state_;
	require(av_frame_make_writable(state.software_frame), state.hardware,
		"Make the exact encoder upload frame writable");
	state.scaler = sws_getCachedContext(
		state.scaler, source_width, source_height, source_format,
		state.context->width, state.context->height, state.upload_format,
		SWS_BICUBIC, nullptr, nullptr, nullptr
	);
	if (state.scaler == nullptr) fail(state.hardware, "Create the exact encoder color conversion", AVERROR(ENOMEM));
	const auto scaled = sws_scale(
		state.scaler, source_data, source_linesize, 0, source_height,
		state.software_frame->data, state.software_frame->linesize
	);
	if (scaled != state.context->height) fail(state.hardware, "Convert one exact encoder frame", AVERROR(EINVAL));
	av_frame_remove_side_data(state.software_frame, AV_FRAME_DATA_MASTERING_DISPLAY_METADATA);
	av_frame_remove_side_data(state.software_frame, AV_FRAME_DATA_CONTENT_LIGHT_LEVEL);
	if (source_properties != nullptr) {
		require(av_frame_copy_props(state.software_frame, source_properties), state.hardware,
			"Preserve frame color, HDR, and alpha properties");
	}
	state.software_frame->pts = pts;
	state.software_frame->duration = duration;
	if (!state.hardware_frames) return state.software_frame;
	av_frame_unref(state.hardware_frame);
	require(av_hwframe_get_buffer(state.frames, state.hardware_frame, 0), true,
		"Acquire one exact hardware encode frame");
	require(av_hwframe_transfer_data(state.hardware_frame, state.software_frame, 0), true,
		"Upload one exact hardware encode frame");
	require(av_frame_copy_props(state.hardware_frame, state.software_frame), true,
		"Preserve uploaded frame properties");
	state.hardware_frame->pts = pts;
	state.hardware_frame->duration = duration;
	return state.hardware_frame;
}

bool ffmpeg_professional_cpu_encoder_set_available() noexcept {
	for (const auto name : {
		"libx264", "libx265", "libvpx-vp9", "prores_ks", "dnxhd", "ffv1", "png", "tiff", "exr",
	}) if (avcodec_find_encoder_by_name(name) == nullptr) return false;
	return true;
}

} // namespace framescaper::media
