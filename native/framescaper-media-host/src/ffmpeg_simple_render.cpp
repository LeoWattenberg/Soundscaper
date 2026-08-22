// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_simple_render.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libavutil/pixfmt.h>
#include <libswscale/swscale.h>
}

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>

namespace framescaper::media {
namespace {

class render_failure final : public std::runtime_error {
public:
	render_failure(std::string code, std::string message, const int exit_code = 70)
		: std::runtime_error(std::move(message)), code_{std::move(code)}, exit_code_{exit_code} {}
	[[nodiscard]] const std::string& code() const noexcept { return code_; }
	[[nodiscard]] int exit_code() const noexcept { return exit_code_; }
private:
	std::string code_;
	int exit_code_;
};

[[nodiscard]] std::string escaped(const std::string_view value) {
	std::string result;
	for (const char character : value) {
		if (character == '\\' || character == '"') result += '\\';
		result += character;
	}
	return result;
}

[[nodiscard]] std::string error_text(const int code) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> bytes{};
	av_strerror(code, bytes.data(), bytes.size());
	return std::string{bytes.data()};
}

void require(const int status, const std::string_view action) {
	if (status < 0) throw render_failure("ffmpeg-operation-failed", std::string{action} + ": " + error_text(status));
}

void not_cancelled() {
	if (media_cancellation_requested()) throw render_failure("cancelled", "The media job was cancelled.", 75);
}

class mux_output final {
public:
	mux_output(std::filesystem::path path, const std::uint64_t maximum_bytes)
		: path_{std::move(path)}, maximum_bytes_{maximum_bytes} {
#if defined(_WIN32)
		if (_wfopen_s(&file_, path_.c_str(), L"w+bN") != 0 || file_ == nullptr) {
#else
		file_ = std::fopen(path_.c_str(), "w+bx");
		if (file_ == nullptr) {
#endif
			throw render_failure("output-create", "The authenticated output could not be created exclusively.", 74);
		}
	}
	~mux_output() {
		if (file_ != nullptr) std::fclose(file_);
		if (!committed_) { std::error_code ignored; std::filesystem::remove(path_, ignored); }
	}
	[[nodiscard]] int write(const std::uint8_t* bytes, const int count) noexcept {
		if (count < 0 || failed_ || static_cast<std::uint64_t>(count) > maximum_bytes_ - high_water_) {
			failed_ = true;
			return AVERROR(ENOSPC);
		}
		if (count > 0 && std::fwrite(bytes, 1, static_cast<std::size_t>(count), file_)
			!= static_cast<std::size_t>(count)) {
			failed_ = true;
			return AVERROR(EIO);
		}
		const auto position = tell();
		if (position < 0) { failed_ = true; return AVERROR(EIO); }
		high_water_ = std::max(high_water_, static_cast<std::uint64_t>(position));
		return count;
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
	void commit() {
		if (failed_ || std::fflush(file_) != 0) throw render_failure("output-flush", "The encoded output cannot be flushed.", 74);
		committed_ = true;
	}
	[[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }
	[[nodiscard]] std::uint64_t byte_length() const noexcept { return high_water_; }
private:
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

[[nodiscard]] int write_packet(void* opaque, const std::uint8_t* bytes, const int count) {
	return static_cast<mux_output*>(opaque)->write(bytes, count);
}

[[nodiscard]] std::int64_t seek_output(void* opaque, const std::int64_t offset, const int whence) {
	return static_cast<mux_output*>(opaque)->seek(offset, whence);
}

struct input_session final {
	AVFormatContext* format{};
	AVCodecContext* decoder{};
	AVPacket* packet{};
	AVFrame* frame{};
	int stream_index{-1};
	input_session() = default;
	input_session(const input_session&) = delete;
	input_session& operator=(const input_session&) = delete;
	input_session(input_session&& other) noexcept
		: format{std::exchange(other.format, nullptr)}, decoder{std::exchange(other.decoder, nullptr)},
		packet{std::exchange(other.packet, nullptr)}, frame{std::exchange(other.frame, nullptr)},
		stream_index{std::exchange(other.stream_index, -1)} {}
	~input_session() {
		av_frame_free(&frame);
		av_packet_free(&packet);
		avcodec_free_context(&decoder);
		avformat_close_input(&format);
	}
};

[[nodiscard]] input_session open_source(const std::filesystem::path& path) {
	input_session input;
	AVDictionary* options = nullptr;
	av_dict_set(&options, "protocol_whitelist", "file", 0);
	av_dict_set(&options, "format_whitelist", "mov,matroska,webm,avi,mpegts,mpeg,ogg", 0);
	const auto text = path.string();
	auto status = avformat_open_input(&input.format, text.c_str(), nullptr, &options);
	av_dict_free(&options);
	require(status, "Open the authenticated simple-render source");
	require(avformat_find_stream_info(input.format, nullptr), "Read simple-render stream information");
	const AVCodec* decoder = nullptr;
	input.stream_index = av_find_best_stream(input.format, AVMEDIA_TYPE_VIDEO, -1, -1, &decoder, 0);
	if (input.stream_index < 0 || decoder == nullptr) throw render_failure("video-stream-missing", "No video stream can feed the simple renderer.", 65);
	input.decoder = avcodec_alloc_context3(decoder);
	if (input.decoder == nullptr) throw render_failure("decode-allocation", "The simple-render decoder cannot be allocated.");
	require(avcodec_parameters_to_context(
		input.decoder, input.format->streams[input.stream_index]->codecpar
	), "Copy simple-render decoder parameters");
	input.decoder->thread_count = 1;
	require(avcodec_open2(input.decoder, decoder, nullptr), "Open the simple-render CPU decoder");
	input.packet = av_packet_alloc();
	input.frame = av_frame_alloc();
	if (input.packet == nullptr || input.frame == nullptr) throw render_failure("decode-allocation", "Simple-render frame storage cannot be allocated.");
	return input;
}

struct output_session final {
	AVFormatContext* format{};
	AVCodecContext* encoder{};
	AVStream* stream{};
	AVIOContext* io{};
	AVFrame* frame{};
	SwsContext* scaler{};
	output_session() = default;
	output_session(const output_session&) = delete;
	output_session& operator=(const output_session&) = delete;
	output_session(output_session&& other) noexcept
		: format{std::exchange(other.format, nullptr)}, encoder{std::exchange(other.encoder, nullptr)},
		stream{std::exchange(other.stream, nullptr)}, io{std::exchange(other.io, nullptr)},
		frame{std::exchange(other.frame, nullptr)}, scaler{std::exchange(other.scaler, nullptr)} {}
	~output_session() {
		sws_freeContext(scaler);
		av_frame_free(&frame);
		avcodec_free_context(&encoder);
		if (io != nullptr) { av_freep(&io->buffer); avio_context_free(&io); }
		avformat_free_context(format);
	}
};

void require_closed_simple_plan(const admitted_media_plan& plan) {
	if (!plan.simple_full_frame_clip || plan.source_sha256.size() != 1) {
		throw render_failure("unsupported-render-subset", "Only one exact full-frame clip is implemented by this CPU adapter.", 78);
	}
	if (plan.includes_audio) throw render_failure("unsupported-audio-subset", "The simple CPU adapter does not yet mix audio.", 78);
	if (plan.pixel_format != "yuv420p" || plan.frame_rate_num == 0 || plan.frame_rate_den == 0) {
		throw render_failure("unsupported-output-format", "The simple CPU adapter requires exact YUV420P rational output.", 78);
	}
	const bool h264 = plan.container == "mp4" && plan.video_codec == "h264" && plan.video_encoder == "libx264";
	const bool vp9 = plan.container == "webm" && plan.video_codec == "vp9" && plan.video_encoder == "libvpx-vp9";
	if (!h264 && !vp9) throw render_failure("unsupported-codec-combination", "The canonical container and encoder combination is unsupported.", 78);
}

[[nodiscard]] output_session open_output(const invocation& job, mux_output& bytes) {
	output_session output;
	const auto& plan = job.admitted_plan;
	const AVCodec* codec = avcodec_find_encoder_by_name(plan.video_encoder.c_str());
	if (codec == nullptr) throw render_failure(
		"codec-policy-unavailable", "The exact planned CPU encoder is absent from this licensed build.", 78
	);
	require(avformat_alloc_output_context2(
		&output.format, nullptr, plan.container.c_str(), nullptr
	), "Create the exact delivery muxer");
	output.encoder = avcodec_alloc_context3(codec);
	if (output.encoder == nullptr) throw render_failure("encode-allocation", "The delivery encoder cannot be allocated.");
	output.encoder->width = static_cast<int>(plan.width);
	output.encoder->height = static_cast<int>(plan.height);
	output.encoder->pix_fmt = AV_PIX_FMT_YUV420P;
	output.encoder->time_base = AVRational{
		static_cast<int>(plan.frame_rate_den), static_cast<int>(plan.frame_rate_num),
	};
	output.encoder->framerate = AVRational{
		static_cast<int>(plan.frame_rate_num), static_cast<int>(plan.frame_rate_den),
	};
	output.encoder->thread_count = 1;
	output.encoder->gop_size = 12;
	output.encoder->max_b_frames = 0;
	if ((output.format->oformat->flags & AVFMT_GLOBALHEADER) != 0) output.encoder->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
	if (plan.video_encoder == "libx264") {
		require(av_opt_set(output.encoder->priv_data, "preset", "medium", 0), "Set the closed H.264 preset");
		require(av_opt_set(output.encoder->priv_data, "crf", "18", 0), "Set the closed H.264 quality");
	} else {
		require(av_opt_set(output.encoder->priv_data, "deadline", "good", 0), "Set the closed VP9 deadline");
		require(av_opt_set(output.encoder->priv_data, "crf", "18", 0), "Set the closed VP9 quality");
	}
	require(avcodec_open2(output.encoder, codec, nullptr), "Open the exact CPU delivery encoder");
	output.stream = avformat_new_stream(output.format, nullptr);
	if (output.stream == nullptr) throw render_failure("encode-allocation", "The delivery stream cannot be allocated.");
	output.stream->time_base = output.encoder->time_base;
	require(avcodec_parameters_from_context(output.stream->codecpar, output.encoder), "Copy delivery stream parameters");
	auto* buffer = static_cast<unsigned char*>(av_malloc(64U * 1024U));
	if (buffer == nullptr) throw render_failure("encode-allocation", "The delivery output buffer cannot be allocated.");
	output.io = avio_alloc_context(buffer, 64U * 1024U, 1, &bytes, nullptr, write_packet, seek_output);
	if (output.io == nullptr) { av_free(buffer); throw render_failure("encode-allocation", "The delivery IO context cannot be allocated."); }
	output.format->pb = output.io;
	output.format->flags |= AVFMT_FLAG_CUSTOM_IO;
	require(avformat_write_header(output.format, nullptr), "Write the delivery header");
	output.frame = av_frame_alloc();
	if (output.frame == nullptr) throw render_failure("encode-allocation", "The delivery frame cannot be allocated.");
	output.frame->format = output.encoder->pix_fmt;
	output.frame->width = output.encoder->width;
	output.frame->height = output.encoder->height;
	require(av_frame_get_buffer(output.frame, 32), "Allocate a delivery frame");
	return output;
}

void write_encoded_packets(output_session& output) {
	AVPacket* packet = av_packet_alloc();
	if (packet == nullptr) throw render_failure("encode-allocation", "A delivery packet cannot be allocated.");
	try {
		while (true) {
			not_cancelled();
			const auto status = avcodec_receive_packet(output.encoder, packet);
			if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) break;
			require(status, "Receive a delivery packet");
			av_packet_rescale_ts(packet, output.encoder->time_base, output.stream->time_base);
			packet->stream_index = output.stream->index;
			require(av_interleaved_write_frame(output.format, packet), "Write a delivery packet");
			av_packet_unref(packet);
		}
	} catch (...) { av_packet_free(&packet); throw; }
	av_packet_free(&packet);
}

void consume_frame(const invocation& job, output_session& output, AVFrame* decoded, std::uint64_t& ordinal) {
	const auto& plan = job.admitted_plan;
	if (ordinal++ < plan.source_in_frame) return;
	const auto output_index = ordinal - plan.source_in_frame - 1;
	if (output_index >= plan.output_frame_count) return;
	if (decoded->width != static_cast<int>(plan.width) || decoded->height != static_cast<int>(plan.height)) {
		throw render_failure("unsupported-geometry-subset", "The simple clip must already equal the exact output canvas.", 78);
	}
	if (output.scaler == nullptr) output.scaler = sws_getContext(
		decoded->width, decoded->height, static_cast<AVPixelFormat>(decoded->format),
		output.encoder->width, output.encoder->height, output.encoder->pix_fmt,
		SWS_BICUBIC, nullptr, nullptr, nullptr
	);
	if (output.scaler == nullptr) throw render_failure("render-scale", "The closed pixel conversion cannot be created.");
	require(av_frame_make_writable(output.frame), "Make a delivery frame writable");
	sws_scale(output.scaler, decoded->data, decoded->linesize, 0, decoded->height, output.frame->data, output.frame->linesize);
	output.frame->pts = static_cast<std::int64_t>(output_index);
	output.frame->duration = 1;
	require(avcodec_send_frame(output.encoder, output.frame), "Send a delivery frame");
	write_encoded_packets(output);
}

void decode_into_output(const invocation& job, input_session& input, output_session& output) {
	const auto source_rate = av_guess_frame_rate(input.format, input.format->streams[input.stream_index], nullptr);
	const auto& plan = job.admitted_plan;
	if (source_rate.num <= 0 || source_rate.den <= 0
		|| static_cast<std::int64_t>(source_rate.num) * plan.frame_rate_den
			!= static_cast<std::int64_t>(source_rate.den) * plan.frame_rate_num) {
		throw render_failure("unsupported-rate-conversion", "The simple clip requires an unchanged exact frame rate.", 78);
	}
	std::uint64_t decoded_ordinal = 0;
	auto drain = [&]() {
		while (true) {
			not_cancelled();
			const auto status = avcodec_receive_frame(input.decoder, input.frame);
			if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) return;
			require(status, "Receive a simple-render frame");
			consume_frame(job, output, input.frame, decoded_ordinal);
			av_frame_unref(input.frame);
		}
	};
	while (decoded_ordinal < plan.source_in_frame + plan.output_frame_count) {
		not_cancelled();
		const auto status = av_read_frame(input.format, input.packet);
		if (status == AVERROR_EOF) break;
		require(status, "Read a simple-render packet");
		if (input.packet->stream_index == input.stream_index) {
			const auto sent = avcodec_send_packet(input.decoder, input.packet);
			av_packet_unref(input.packet);
			require(sent, "Send a simple-render packet");
			drain();
		} else av_packet_unref(input.packet);
	}
	if (decoded_ordinal < plan.source_in_frame + plan.output_frame_count) {
		require(avcodec_send_packet(input.decoder, nullptr), "Flush the simple-render decoder");
		drain();
	}
	if (decoded_ordinal < plan.source_in_frame + plan.output_frame_count) {
		throw render_failure("source-too-short", "The source ended before the exact output frame count.", 78);
	}
}

} // namespace

engine_result execute_simple_render_job(const invocation& job) {
	try {
		require_closed_simple_plan(job.admitted_plan);
		auto input = open_source(job.sources.front());
		mux_output bytes{job.temporary_output, job.maximum_output_bytes};
		auto output = open_output(job, bytes);
		decode_into_output(job, input, output);
		require(avcodec_send_frame(output.encoder, nullptr), "Flush the exact delivery encoder");
		write_encoded_packets(output);
		require(av_write_trailer(output.format), "Finalize the exact delivery container");
		if (sha256_file(job.sources.front()) != job.source_sha256.front()) {
			throw render_failure("source-changed", "The source digest changed during simple rendering.", 65);
		}
		bytes.commit();
		const auto sha256 = sha256_file(bytes.path());
		std::ostringstream result;
		result << "{\"contractVersion\":1,\"operation\":\"" << operation_name(job.kind) << "\","
			<< "\"subset\":\"single-full-frame-clip-v1\",\"frameCount\":" << job.admitted_plan.output_frame_count << ','
			<< "\"byteLength\":" << bytes.byte_length() << ",\"sha256\":\"" << sha256 << "\"}";
		return {0, result.str()};
	} catch (const render_failure& error) {
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	} catch (const std::exception& error) {
		return {70, "{\"error\":\"simple-render-failure\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
