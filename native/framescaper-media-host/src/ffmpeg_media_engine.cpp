// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_media_engine.hpp"
#include "exact_retime_ordinal.hpp"
#include "ffmpeg_image_sequence_decode.hpp"
#include "ffmpeg_selected_v20_render.hpp"
#include "ffmpeg_simple_render.hpp"
#include "professional_source_probe.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavfilter/avfilter.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libavutil/opt.h>
#include <libavutil/pixfmt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
}

#include <array>
#include <cerrno>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <functional>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace framescaper::media {
namespace {

static_assert(LIBAVUTIL_VERSION_MAJOR == 61, "The host requires FFmpeg 9.0.1 libavutil.");
static_assert(LIBAVCODEC_VERSION_MAJOR == 63, "The host requires FFmpeg 9.0.1 libavcodec.");
static_assert(LIBAVFORMAT_VERSION_MAJOR == 63, "The host requires FFmpeg 9.0.1 libavformat.");
static_assert(LIBAVFILTER_VERSION_MAJOR == 12, "The host requires FFmpeg 9.0.1 libavfilter.");
static_assert(LIBSWSCALE_VERSION_MAJOR == 10, "The host requires FFmpeg 9.0.1 libswscale.");
static_assert(LIBSWRESAMPLE_VERSION_MAJOR == 7, "The host requires FFmpeg 9.0.1 libswresample.");
static_assert(soundscaper::framescaper::kMaximumExactBits == 4096);

volatile std::sig_atomic_t cancellation_requested = 0;

extern "C" void request_cancellation(const int) { cancellation_requested = 1; }

[[nodiscard]] int interrupted(void*) { return cancellation_requested != 0 ? 1 : 0; }

[[nodiscard]] std::string escaped(const std::string_view value) {
	std::string result;
	for (const char character : value) {
		if (character == '\\' || character == '"') result += '\\';
		if (character == '\n') result += "\\n";
		else if (character == '\r') result += "\\r";
		else result += character;
	}
	return result;
}

[[nodiscard]] std::string ffmpeg_error(const int code) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> buffer{};
	av_strerror(code, buffer.data(), buffer.size());
	return std::string{buffer.data()};
}

class media_failure final : public std::runtime_error {
public:
	media_failure(std::string code, std::string message, const int exit_code = 70)
		: std::runtime_error(std::move(message)), code_{std::move(code)}, exit_code_{exit_code} {}
	[[nodiscard]] const std::string& code() const noexcept { return code_; }
	[[nodiscard]] int exit_code() const noexcept { return exit_code_; }
private:
	std::string code_;
	int exit_code_;
};

void require_ffmpeg(const int status, const std::string_view action) {
	if (status < 0) throw media_failure(
		"ffmpeg-operation-failed", std::string{action} + ": " + ffmpeg_error(status)
	);
}

void check_cancellation() {
	if (cancellation_requested != 0) throw media_failure("cancelled", "The media job was cancelled.", 75);
}

class exclusive_output final {
public:
	exclusive_output(std::filesystem::path path, const std::uint64_t maximum_bytes)
		: path_{std::move(path)}, maximum_bytes_{maximum_bytes} {
#if defined(_WIN32)
		if (_wfopen_s(&file_, path_.c_str(), L"w+bN") != 0 || file_ == nullptr) {
#else
		file_ = std::fopen(path_.c_str(), "w+bx");
		if (file_ == nullptr) {
#endif
			throw media_failure("output-create", "The authenticated output could not be created exclusively.", 74);
		}
	}
	exclusive_output(const exclusive_output&) = delete;
	exclusive_output& operator=(const exclusive_output&) = delete;
	~exclusive_output() {
		if (file_ != nullptr) std::fclose(file_);
		if (!committed_) { std::error_code ignored; std::filesystem::remove(path_, ignored); }
	}

	void write(const void* bytes, const std::size_t count) {
		if (!try_write(bytes, count)) throw media_failure("output-limit", "The media output exceeded its exact byte grant.", 74);
	}
	[[nodiscard]] bool try_write(const void* bytes, const std::size_t count) noexcept {
		if (failed_ || count > maximum_bytes_ - high_water_) { failed_ = true; return false; }
		if (count > 0 && std::fwrite(bytes, 1, count, file_) != count) { failed_ = true; return false; }
		const auto position = tell();
		if (position < 0) { failed_ = true; return false; }
		high_water_ = std::max(high_water_, static_cast<std::uint64_t>(position));
		return true;
	}
	[[nodiscard]] std::int64_t seek(const std::int64_t offset, const int whence) noexcept {
		if (whence == AVSEEK_SIZE) return static_cast<std::int64_t>(high_water_);
#if defined(_WIN32)
		if (_fseeki64(file_, offset, whence) != 0) return AVERROR(errno);
#else
		if (fseeko(file_, static_cast<off_t>(offset), whence) != 0) return AVERROR(errno);
#endif
		return tell();
	}
	[[nodiscard]] std::uint64_t position() const {
		const auto result = tell();
		if (result < 0) throw media_failure("output-position", "The media output position is unavailable.", 74);
		return static_cast<std::uint64_t>(result);
	}
	void patch_u64(const std::uint64_t offset, const std::uint64_t value) {
		const auto restore = position();
		if (seek(static_cast<std::int64_t>(offset), SEEK_SET) < 0) throw media_failure("output-seek", "The frame pack cannot be finalized.", 74);
		write_u64(value);
		if (seek(static_cast<std::int64_t>(restore), SEEK_SET) < 0) throw media_failure("output-seek", "The frame pack cannot restore its end position.", 74);
	}
	void write_u32(const std::uint32_t value) { write_integer(value); }
	void write_u64(const std::uint64_t value) { write_integer(value); }
	void write_i64(const std::int64_t value) { write_integer(static_cast<std::uint64_t>(value)); }
	void commit() {
		if (failed_ || std::fflush(file_) != 0) throw media_failure("output-flush", "The media output could not be flushed.", 74);
		committed_ = true;
	}
	[[nodiscard]] std::uint64_t byte_length() const noexcept { return high_water_; }
	[[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

private:
	template<typename Integer> void write_integer(const Integer value) {
		std::array<std::uint8_t, sizeof(Integer)> bytes{};
		for (std::size_t index = 0; index < bytes.size(); ++index) {
			bytes[index] = static_cast<std::uint8_t>(value >> (index * 8U));
		}
		write(bytes.data(), bytes.size());
	}
	[[nodiscard]] std::int64_t tell() const noexcept {
#if defined(_WIN32)
		return _ftelli64(file_);
#else
		return static_cast<std::int64_t>(ftello(file_));
#endif
	}
	std::filesystem::path path_;
	std::uint64_t maximum_bytes_{};
	std::uint64_t high_water_{};
	std::FILE* file_{};
	bool failed_{};
	bool committed_{};
};

struct decoder_session final {
	AVFormatContext* format{};
	AVCodecContext* codec{};
	AVPacket* packet{};
	AVFrame* frame{};
	int stream_index{-1};
	decoder_session() = default;
	decoder_session(const decoder_session&) = delete;
	decoder_session& operator=(const decoder_session&) = delete;
	decoder_session(decoder_session&& other) noexcept
		: format{std::exchange(other.format, nullptr)}, codec{std::exchange(other.codec, nullptr)},
		packet{std::exchange(other.packet, nullptr)}, frame{std::exchange(other.frame, nullptr)},
		stream_index{std::exchange(other.stream_index, -1)} {}
	~decoder_session() {
		av_frame_free(&frame);
		av_packet_free(&packet);
		avcodec_free_context(&codec);
		avformat_close_input(&format);
	}
};

[[nodiscard]] decoder_session open_decoder(const std::filesystem::path& path) {
	decoder_session session;
	session.format = avformat_alloc_context();
	if (session.format == nullptr) throw media_failure("decode-allocation", "The input context cannot be allocated.");
	session.format->interrupt_callback = AVIOInterruptCB{interrupted, nullptr};
	AVDictionary* options = nullptr;
	av_dict_set(&options, "protocol_whitelist", "file", 0);
	av_dict_set(&options, "format_whitelist", "mov,matroska,webm,avi,mpegts,mpeg,ogg,wav,flac,png_pipe,tiff_pipe,exr_pipe,mjpeg,jpeg_pipe", 0);
	const auto path_text = path.string();
	auto status = avformat_open_input(&session.format, path_text.c_str(), nullptr, &options);
	av_dict_free(&options);
	require_ffmpeg(status, "Open the authenticated source");
	require_ffmpeg(avformat_find_stream_info(session.format, nullptr), "Read source stream information");
	const AVCodec* decoder = nullptr;
	session.stream_index = av_find_best_stream(
		session.format, AVMEDIA_TYPE_VIDEO, -1, -1, &decoder, 0
	);
	if (session.stream_index < 0 || decoder == nullptr) {
		throw media_failure("video-stream-missing", "The authenticated source has no supported video stream.", 65);
	}
	session.codec = avcodec_alloc_context3(decoder);
	if (session.codec == nullptr) throw media_failure("decode-allocation", "The decoder context cannot be allocated.");
	require_ffmpeg(avcodec_parameters_to_context(
		session.codec, session.format->streams[session.stream_index]->codecpar
	), "Copy decoder parameters");
	session.codec->thread_count = 0;
	require_ffmpeg(avcodec_open2(session.codec, decoder, nullptr), "Open the CPU decoder");
	session.packet = av_packet_alloc();
	session.frame = av_frame_alloc();
	if (session.packet == nullptr || session.frame == nullptr) {
		throw media_failure("decode-allocation", "Decode frame storage cannot be allocated.");
	}
	return session;
}

void drain_decoder(decoder_session& session, const std::function<void(AVFrame*)>& consume) {
	while (true) {
		check_cancellation();
		const auto status = avcodec_receive_frame(session.codec, session.frame);
		if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) return;
		require_ffmpeg(status, "Receive a decoded frame");
		consume(session.frame);
		av_frame_unref(session.frame);
	}
}

void decode_all(decoder_session& session, const std::function<void(AVFrame*)>& consume) {
	while (true) {
		check_cancellation();
		const auto read = av_read_frame(session.format, session.packet);
		if (read == AVERROR_EOF) break;
		require_ffmpeg(read, "Read an authenticated source packet");
		if (session.packet->stream_index == session.stream_index) {
			const auto sent = avcodec_send_packet(session.codec, session.packet);
			av_packet_unref(session.packet);
			require_ffmpeg(sent, "Send a source packet to the decoder");
			drain_decoder(session, consume);
		} else av_packet_unref(session.packet);
	}
	require_ffmpeg(avcodec_send_packet(session.codec, nullptr), "Flush the source decoder");
	drain_decoder(session, consume);
}

[[nodiscard]] engine_result probe_source(const invocation& job) {
	const auto& source = job.sources.front();
	auto session = open_decoder(source);
	std::size_t video = 0;
	std::size_t audio = 0;
	for (unsigned index = 0; index < session.format->nb_streams; ++index) {
		const auto type = session.format->streams[index]->codecpar->codec_type;
		if (type == AVMEDIA_TYPE_VIDEO) ++video;
		else if (type == AVMEDIA_TYPE_AUDIO) ++audio;
	}
	std::ostringstream result;
	result << "{\"contractVersion\":1,\"operation\":\"probe-video-source\","
		<< "\"format\":\"" << escaped(session.format->iformat ? session.format->iformat->name : "") << "\","
		<< "\"durationTimeBase\":" << session.format->duration << ','
		<< "\"videoStreams\":" << video << ",\"audioStreams\":" << audio << ','
		<< "\"width\":" << session.codec->width << ",\"height\":" << session.codec->height << ','
		<< "\"characteristics\":"
		<< professional_source_characteristics_json(*session.format, session.stream_index) << '}';
	if (sha256_file(source) != job.source_sha256.front()) {
		throw media_failure("source-changed", "The source digest changed during professional probing.", 65);
	}
	return {0, result.str()};
}

[[nodiscard]] engine_result decode_to_frame_pack(const invocation& job) {
	auto session = open_decoder(job.sources.front());
	if (session.codec->width <= 0 || session.codec->height <= 0) {
		throw media_failure("decode-geometry", "The source video geometry is invalid.", 65);
	}
	exclusive_output output{job.decode_output, job.maximum_output_bytes};
	constexpr std::string_view magic = "framescaper-rgba-frame-pack-v1\n";
	output.write(magic.data(), magic.size());
	output.write_u32(1);
	output.write_u32(static_cast<std::uint32_t>(session.codec->width));
	output.write_u32(static_cast<std::uint32_t>(session.codec->height));
	const auto count_offset = output.position();
	output.write_u64(0);
	const auto time_base = session.format->streams[session.stream_index]->time_base;
	output.write_u32(static_cast<std::uint32_t>(time_base.num));
	output.write_u32(static_cast<std::uint32_t>(time_base.den));
	SwsContext* scaler = sws_getContext(
		session.codec->width, session.codec->height, session.codec->pix_fmt,
		session.codec->width, session.codec->height, AV_PIX_FMT_RGBA,
		SWS_BICUBIC, nullptr, nullptr, nullptr
	);
	if (scaler == nullptr) throw media_failure("decode-scale", "The closed RGBA conversion cannot be created.");
	std::uint64_t frame_count = 0;
	try {
		const auto frame_bytes = av_image_get_buffer_size(
			AV_PIX_FMT_RGBA, session.codec->width, session.codec->height, 1
		);
		if (frame_bytes <= 0) throw media_failure("decode-geometry", "The RGBA frame size is invalid.");
		std::vector<std::uint8_t> rgba(static_cast<std::size_t>(frame_bytes));
		std::array<std::uint8_t*, 4> planes{};
		std::array<int, 4> strides{};
		require_ffmpeg(av_image_fill_arrays(
			planes.data(), strides.data(), rgba.data(), AV_PIX_FMT_RGBA,
			session.codec->width, session.codec->height, 1
		), "Lay out one RGBA frame");
		decode_all(session, [&](AVFrame* frame) {
			if (frame->width != session.codec->width || frame->height != session.codec->height
				|| frame->format != session.codec->pix_fmt) {
				throw media_failure("decode-format-change", "Mid-stream video format changes are not in this decode subset.", 78);
			}
			sws_scale(scaler, frame->data, frame->linesize, 0, frame->height, planes.data(), strides.data());
			output.write_u64(frame_count);
			output.write_i64(frame->best_effort_timestamp);
			output.write_i64(frame->duration);
			output.write_u64(static_cast<std::uint64_t>(rgba.size()));
			output.write(rgba.data(), rgba.size());
			++frame_count;
		});
	} catch (...) { sws_freeContext(scaler); throw; }
	sws_freeContext(scaler);
	output.patch_u64(count_offset, frame_count);
	if (sha256_file(job.sources.front()) != job.source_sha256.front()) {
		throw media_failure("source-changed", "The source digest changed during decode.", 65);
	}
	output.commit();
	const auto output_digest = sha256_file(output.path());
	std::ostringstream result;
	result << "{\"contractVersion\":1,\"operation\":\"media-decode\","
		<< "\"framePack\":\"framescaper-rgba-frame-pack-v1\",\"frameCount\":" << frame_count << ','
		<< "\"width\":" << session.codec->width << ",\"height\":" << session.codec->height << ','
		<< "\"byteLength\":" << output.byte_length() << ",\"sha256\":\"" << output_digest << "\"}";
	return {0, result.str()};
}

[[nodiscard]] int mux_write(void* opaque, const std::uint8_t* bytes, const int count) {
	return static_cast<exclusive_output*>(opaque)->try_write(bytes, static_cast<std::size_t>(count))
		? count : AVERROR(ENOSPC);
}

[[nodiscard]] std::int64_t mux_seek(void* opaque, const std::int64_t offset, const int whence) {
	return static_cast<exclusive_output*>(opaque)->seek(offset, whence);
}

void drain_encoder(AVCodecContext* encoder, AVStream* stream, AVFormatContext* output) {
	AVPacket* packet = av_packet_alloc();
	if (packet == nullptr) throw media_failure("encode-allocation", "An encoder packet cannot be allocated.");
	try {
		while (true) {
			check_cancellation();
			const auto status = avcodec_receive_packet(encoder, packet);
			if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) break;
			require_ffmpeg(status, "Receive a ProRes packet");
			av_packet_rescale_ts(packet, encoder->time_base, stream->time_base);
			packet->stream_index = stream->index;
			require_ffmpeg(av_interleaved_write_frame(output, packet), "Write a ProRes packet");
			av_packet_unref(packet);
		}
	} catch (...) { av_packet_free(&packet); throw; }
	av_packet_free(&packet);
}

[[nodiscard]] std::pair<std::uint32_t, std::uint32_t> exact_proxy_geometry(
	const int source_width,
	const int source_height
) {
	if (source_width <= 0 || source_height <= 0) {
		throw media_failure("proxy-geometry", "The original geometry is invalid.", 78);
	}
	std::uint64_t width{};
	std::uint64_t height{};
	if (source_width <= 1280 && source_height <= 720) {
		width = static_cast<std::uint64_t>(source_width);
		height = static_cast<std::uint64_t>(source_height);
	} else if (1280ULL * static_cast<std::uint64_t>(source_height)
		<= 720ULL * static_cast<std::uint64_t>(source_width)) {
		width = 1280;
		height = static_cast<std::uint64_t>(source_height) * 1280ULL
			/ static_cast<std::uint64_t>(source_width);
	} else {
		height = 720;
		width = static_cast<std::uint64_t>(source_width) * 720ULL
			/ static_cast<std::uint64_t>(source_height);
	}
	width -= width % 2;
	height -= height % 2;
	if (width < 2 || height < 2) {
		throw media_failure("proxy-geometry", "The original cannot fit the even proxy geometry.", 78);
	}
	return {static_cast<std::uint32_t>(width), static_cast<std::uint32_t>(height)};
}

[[nodiscard]] engine_result create_proxy(const invocation& job) {
	auto source = open_decoder(job.sources.front());
	const auto expected_geometry = exact_proxy_geometry(source.codec->width, source.codec->height);
	if (job.proxy_width != expected_geometry.first || job.proxy_height != expected_geometry.second) {
		throw media_failure(
			"proxy-geometry-mismatch",
			"The proxy geometry does not equal the exact no-upscale aspect-fit recipe.",
			78
		);
	}
	exclusive_output destination{job.temporary_output, job.maximum_output_bytes};
	AVFormatContext* output = nullptr;
	require_ffmpeg(avformat_alloc_output_context2(&output, nullptr, "mov", nullptr), "Create the MOV muxer");
	if (output == nullptr) throw media_failure("proxy-muxer", "The MOV muxer is unavailable.", 78);
	AVCodecContext* encoder = nullptr;
	AVFrame* scaled = nullptr;
	SwsContext* scaler = nullptr;
	AVIOContext* io = nullptr;
	try {
		const AVCodec* codec = avcodec_find_encoder_by_name("prores_ks");
		if (codec == nullptr) throw media_failure("proxy-codec-unavailable", "The pinned ProRes encoder is unavailable.", 78);
		encoder = avcodec_alloc_context3(codec);
		if (encoder == nullptr) throw media_failure("encode-allocation", "The ProRes encoder cannot be allocated.");
		const auto input_time_base = source.format->streams[source.stream_index]->time_base;
		if (input_time_base.num <= 0 || input_time_base.den <= 0) {
			throw media_failure("proxy-timing", "The original lacks an exact presentation timebase.", 78);
		}
		encoder->width = static_cast<int>(job.proxy_width);
		encoder->height = static_cast<int>(job.proxy_height);
		encoder->pix_fmt = AV_PIX_FMT_YUV422P10LE;
		encoder->time_base = input_time_base;
		encoder->framerate = av_guess_frame_rate(source.format, source.format->streams[source.stream_index], nullptr);
		encoder->color_primaries = source.codec->color_primaries;
		encoder->color_trc = source.codec->color_trc;
		encoder->colorspace = source.codec->colorspace;
		encoder->color_range = source.codec->color_range;
		encoder->chroma_sample_location = source.codec->chroma_sample_location;
		encoder->profile = AV_PROFILE_PRORES_PROXY;
		if ((output->oformat->flags & AVFMT_GLOBALHEADER) != 0) encoder->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
		require_ffmpeg(av_opt_set(encoder->priv_data, "profile", "proxy", 0), "Select the ProRes Proxy profile");
		require_ffmpeg(avcodec_open2(encoder, codec, nullptr), "Open the CPU ProRes encoder");
		auto* stream = avformat_new_stream(output, nullptr);
		if (stream == nullptr) throw media_failure("encode-allocation", "The MOV stream cannot be allocated.");
		stream->time_base = encoder->time_base;
		require_ffmpeg(avcodec_parameters_from_context(stream->codecpar, encoder), "Copy ProRes stream parameters");
		auto* io_buffer = static_cast<unsigned char*>(av_malloc(64U * 1024U));
		if (io_buffer == nullptr) throw media_failure("encode-allocation", "The MOV output buffer cannot be allocated.");
		io = avio_alloc_context(io_buffer, 64U * 1024U, 1, &destination, nullptr, mux_write, mux_seek);
		if (io == nullptr) { av_free(io_buffer); throw media_failure("encode-allocation", "The MOV output context cannot be allocated."); }
		output->pb = io;
		output->flags |= AVFMT_FLAG_CUSTOM_IO;
		require_ffmpeg(avformat_write_header(output, nullptr), "Write the MOV header");
		scaled = av_frame_alloc();
		if (scaled == nullptr) throw media_failure("encode-allocation", "A ProRes frame cannot be allocated.");
		scaled->format = encoder->pix_fmt;
		scaled->width = encoder->width;
		scaled->height = encoder->height;
		require_ffmpeg(av_frame_get_buffer(scaled, 32), "Allocate a ProRes frame");
		scaler = sws_getContext(
			source.codec->width, source.codec->height, source.codec->pix_fmt,
			encoder->width, encoder->height, encoder->pix_fmt,
			SWS_BICUBIC, nullptr, nullptr, nullptr
		);
		if (scaler == nullptr) throw media_failure("proxy-scale", "The closed proxy scaler cannot be created.");
		decode_all(source, [&](AVFrame* frame) {
			if (frame->best_effort_timestamp == AV_NOPTS_VALUE) {
				throw media_failure("proxy-timing", "A source frame lacks an exact presentation timestamp.", 78);
			}
			require_ffmpeg(av_frame_make_writable(scaled), "Make a ProRes frame writable");
			sws_scale(scaler, frame->data, frame->linesize, 0, frame->height, scaled->data, scaled->linesize);
			scaled->pts = frame->best_effort_timestamp;
			scaled->duration = frame->duration;
			scaled->color_primaries = frame->color_primaries;
			scaled->color_trc = frame->color_trc;
			scaled->colorspace = frame->colorspace;
			scaled->color_range = frame->color_range;
			scaled->chroma_location = frame->chroma_location;
			require_ffmpeg(avcodec_send_frame(encoder, scaled), "Send a frame to the ProRes encoder");
			drain_encoder(encoder, stream, output);
		});
		require_ffmpeg(avcodec_send_frame(encoder, nullptr), "Flush the ProRes encoder");
		drain_encoder(encoder, stream, output);
		require_ffmpeg(av_write_trailer(output), "Finalize the MOV proxy");
		if (sha256_file(job.sources.front()) != job.source_sha256.front()) {
			throw media_failure("source-changed", "The original digest changed during proxy generation.", 65);
		}
		destination.commit();
		const auto output_digest = sha256_file(destination.path());
		std::ostringstream result;
		result << "{\"contractVersion\":1,\"operation\":\"media-proxy\",\"container\":\"mov\","
			<< "\"codec\":\"prores_ks\",\"profile\":\"proxy\",\"width\":" << job.proxy_width << ','
			<< "\"height\":" << job.proxy_height << ",\"exportAuthority\":\"original\","
			<< "\"byteLength\":" << destination.byte_length() << ",\"sha256\":\"" << output_digest << "\"}";
		if (scaler != nullptr) sws_freeContext(scaler);
		av_frame_free(&scaled);
		avcodec_free_context(&encoder);
		if (io != nullptr) { av_freep(&io->buffer); avio_context_free(&io); }
		avformat_free_context(output);
		return {0, result.str()};
	} catch (...) {
		if (scaler != nullptr) sws_freeContext(scaler);
		av_frame_free(&scaled);
		avcodec_free_context(&encoder);
		if (io != nullptr) { av_freep(&io->buffer); avio_context_free(&io); }
		avformat_free_context(output);
		throw;
	}
}

[[nodiscard]] bool exact_retime_self_test() {
	using namespace soundscaper::framescaper;
	const ExactRetimeSegment segment{
		RetimeMode::constant_forward, 0, 1,
		ExactRational(cpp_int("90071992547409909"), cpp_int("9007199254740991")),
		ExactRational(10), ExactRational(1), ExactRational(1),
	};
	return exact_picture_ordinal(segment, 0, 0, 20) == 9;
}

[[nodiscard]] engine_result unsupported_graph(const invocation& job, const std::string_view error) {
	return {78, "{\"error\":\"" + std::string{error} + "\",\"operation\":\""
		+ std::string{operation_name(job.kind)} + "\",\"planVersion\":"
		+ std::to_string(job.admitted_plan.version) + ",\"family\":\""
		+ job.admitted_plan.unsupported_render_family + "\"}"};
}

} // namespace

bool media_cancellation_requested() noexcept { return cancellation_requested != 0; }

engine_result self_test_ffmpeg() {
	const bool versions_match =
		AV_VERSION_MAJOR(avutil_version()) == 61
		&& AV_VERSION_MAJOR(avcodec_version()) == 63
		&& AV_VERSION_MAJOR(avformat_version()) == 63
		&& AV_VERSION_MAJOR(avfilter_version()) == 12
		&& AV_VERSION_MAJOR(swscale_version()) == 10
		&& AV_VERSION_MAJOR(swresample_version()) == 7;
	const bool exact_retime_matches = exact_retime_self_test();
	const bool proxy_encoder_present = avcodec_find_encoder_by_name("prores_ks") != nullptr;
	const bool professional_characteristics_match = professional_source_characteristics_self_test();
	std::ostringstream result;
	result << "{\"contractVersion\":1,\"ffmpeg\":\"9.0.1\","
		<< "\"networkInitialized\":false,\"versionsMatch\":" << (versions_match ? "true" : "false") << ','
		<< "\"exactRetimeMatches\":" << (exact_retime_matches ? "true" : "false") << ','
		<< "\"proresProxyEncoderPresent\":" << (proxy_encoder_present ? "true" : "false") << ','
		<< "\"professionalCharacteristicsMatches\":"
		<< (professional_characteristics_match ? "true" : "false") << '}';
	return {versions_match && exact_retime_matches && proxy_encoder_present
		&& professional_characteristics_match ? 0 : 70, result.str()};
}

engine_result execute_ffmpeg_job(const invocation& job) {
	cancellation_requested = 0;
	av_log_set_level(AV_LOG_ERROR);
	std::signal(SIGTERM, request_cancellation);
	std::signal(SIGINT, request_cancellation);
	try {
		if (job.kind == operation::probe_video_source) return probe_source(job);
		if (job.backend != "native-cpu") {
			return {78, "{\"error\":\"backend-policy-unavailable\",\"operation\":\""
				+ std::string{operation_name(job.kind)} + "\",\"requestedBackend\":\""
				+ job.backend + "\",\"fallbackBackend\":\"native-cpu\"}"};
		}
		if (job.image_sequence) return execute_image_sequence_decode(job);
		if (job.kind == operation::media_decode) return decode_to_frame_pack(job);
		if (job.kind == operation::media_proxy) return create_proxy(job);
		if (job.kind == operation::media_encode || job.kind == operation::media_render) {
			if (job.admitted_plan.version == 7 || job.admitted_plan.version == 8) {
				return execute_selected_v20_render_job(job);
			}
			return unsupported_graph(job, "unsupported-render-subset");
		}
		return unsupported_graph(job, "unsupported-render-subset");
	} catch (const media_failure& error) {
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	} catch (const std::exception& error) {
		return {70, "{\"error\":\"native-media-failure\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
