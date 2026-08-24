// SPDX-License-Identifier: AGPL-3.0-only
// Closed render-family identity: single-full-frame-clip-v1.

#include "ffmpeg_simple_render.hpp"
#include "ffmpeg_decode_session.hpp"
#include "ffmpeg_hardware_encode.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/pixfmt.h>
}

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <memory>
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
		if (_wfopen_s(&file_, path_.c_str(), L"wbxN") != 0 || file_ == nullptr) {
#else
		file_ = std::fopen(path_.c_str(), "wbx");
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

struct output_session final {
	AVFormatContext* format{};
	std::unique_ptr<ffmpeg_video_encode_session> binding;
	AVCodecContext* encoder{};
	AVStream* stream{};
	AVIOContext* io{};
	output_session() = default;
	output_session(const output_session&) = delete;
	output_session& operator=(const output_session&) = delete;
	output_session(output_session&& other) noexcept
		: format{std::exchange(other.format, nullptr)}, binding{std::move(other.binding)},
		encoder{std::exchange(other.encoder, nullptr)}, stream{std::exchange(other.stream, nullptr)},
		io{std::exchange(other.io, nullptr)} {}
	~output_session() {
		encoder = nullptr;
		binding.reset();
		if (io != nullptr) { av_freep(&io->buffer); avio_context_free(&io); }
		avformat_free_context(format);
	}
};

void require_closed_simple_plan(const admitted_media_plan& plan) {
	if (!plan.simple_full_frame_clip || plan.source_sha256.size() != 1) {
		throw render_failure("unsupported-render-subset", "Only one exact full-frame clip is implemented by this adapter.", 78);
	}
	if (plan.includes_audio) throw render_failure("unsupported-audio-subset", "The simple adapter requires an evaluated audio carrier.", 78);
	if (plan.frame_rate_num == 0 || plan.frame_rate_den == 0) {
		throw render_failure("unsupported-output-format", "The simple CPU adapter requires rational output.", 78);
	}
	const bool closed_profile = plan.professional_profile_id == "encode-mp4-h264"
		|| plan.professional_profile_id == "encode-webm-vp9"
		|| plan.professional_profile_id == "encode-hevc-main10-sdr"
		|| plan.professional_profile_id == "encode-hevc-main10-hdr10"
		|| plan.professional_profile_id == "encode-mov-prores-proxy"
		|| plan.professional_profile_id == "encode-mov-prores-422-hq"
		|| plan.professional_profile_id == "encode-mov-prores-4444"
		|| plan.professional_profile_id == "encode-mxf-dnxhr-hqx"
		|| plan.professional_profile_id == "encode-matroska-ffv1";
	if (!closed_profile || plan.container == "image2") {
		throw render_failure("unsupported-codec-combination", "The canonical container and encoder combination is unsupported.", 78);
	}
}

[[nodiscard]] output_session open_output(const invocation& job, mux_output& bytes) {
	output_session output;
	const auto& plan = job.admitted_plan;
	require(avformat_alloc_output_context2(
		&output.format, nullptr, plan.container.c_str(), nullptr
	), "Create the exact delivery muxer");
	const AVRational time_base{
		static_cast<int>(plan.frame_rate_den), static_cast<int>(plan.frame_rate_num),
	};
	output.binding = ffmpeg_video_encode_session::open({
		plan, job.backend, plan.width, plan.height, time_base,
		{time_base.den, time_base.num},
		(output.format->oformat->flags & AVFMT_GLOBALHEADER) != 0,
	});
	output.encoder = output.binding->context();
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
	const std::array<const std::uint8_t*, 4> data{
		decoded->data[0], decoded->data[1], decoded->data[2], decoded->data[3],
	};
	auto* encoded = output.binding->prepare(
		data.data(), decoded->linesize, decoded->width, decoded->height,
		static_cast<AVPixelFormat>(decoded->format), static_cast<std::int64_t>(output_index), 1, decoded
	);
	const auto status = avcodec_send_frame(output.encoder, encoded);
	if (status < 0 && output.binding->hardware()) {
		throw ffmpeg_encode_failure(
			"hardware-encoder-failed", "Send one exact hardware delivery frame: " + error_text(status), 78
		);
	}
	require(status, "Send a delivery frame");
	write_encoded_packets(output);
}

void decode_into_output(const invocation& job, ffmpeg_decode_session& input, output_session& output) {
	const auto source_rate = av_guess_frame_rate(input.format, input.format->streams[input.stream_index], nullptr);
	const auto& plan = job.admitted_plan;
	if (source_rate.num <= 0 || source_rate.den <= 0
		|| static_cast<std::int64_t>(source_rate.num) * plan.frame_rate_den
			!= static_cast<std::int64_t>(source_rate.den) * plan.frame_rate_num) {
		throw render_failure("unsupported-rate-conversion", "The simple clip requires an unchanged exact frame rate.", 78);
	}
	std::uint64_t decoded_ordinal = 0;
	input.decode_all([&](AVFrame* frame) {
		not_cancelled();
		consume_frame(job, output, frame, decoded_ordinal);
	});
	if (decoded_ordinal < plan.source_in_frame + plan.output_frame_count) {
		throw render_failure("source-too-short", "The source ended before the exact output frame count.", 78);
	}
}

} // namespace

engine_result execute_simple_render_job(const invocation& job) {
	try {
		require_closed_simple_plan(job.admitted_plan);
		auto input = ffmpeg_decode_session::open(job.sources.front(), job.backend);
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
			<< "\"byteLength\":" << bytes.byte_length() << ",\"sha256\":\"" << sha256 << "\"}";
		return {0, result.str()};
	} catch (const ffmpeg_decode_failure& error) {
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"requestedBackend\":\""
			+ job.backend + "\",\"fallbackBackend\":\"native-cpu\",\"detail\":\""
			+ escaped(error.what()) + "\"}"};
	} catch (const ffmpeg_encode_failure& error) {
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"requestedBackend\":\""
			+ job.backend + "\",\"fallbackBackend\":\"native-cpu\",\"detail\":\""
			+ escaped(error.what()) + "\"}"};
	} catch (const render_failure& error) {
		if (job.backend != "native-cpu" && error.exit_code() != 75) {
			return {78, "{\"error\":\"hardware-encoder-failed\",\"operation\":\""
				+ std::string{operation_name(job.kind)} + "\",\"requestedBackend\":\""
				+ job.backend + "\",\"fallbackBackend\":\"native-cpu\",\"detail\":\""
				+ escaped(error.what()) + "\"}"};
		}
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	} catch (const std::exception& error) {
		return {70, "{\"error\":\"simple-render-failure\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
