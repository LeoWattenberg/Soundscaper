// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_image_sequence_decode.hpp"
#include "ffmpeg_simple_render.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace framescaper::media {
namespace {

#if defined(FRAMESCAPER_MEDIA_HOST_CONFORMANCE_IMAGE_SEQUENCE)
constexpr bool image_sequence_policy_enabled = true;
#else
constexpr bool image_sequence_policy_enabled = false;
#endif

class sequence_decode_failure final : public std::runtime_error {
public:
	sequence_decode_failure(std::string code, std::string message, const int exit_code = 70)
		: std::runtime_error(std::move(message)), code_{std::move(code)}, exit_code_{exit_code} {}
	[[nodiscard]] const std::string& code() const noexcept { return code_; }
	[[nodiscard]] int exit_code() const noexcept { return exit_code_; }
private:
	std::string code_;
	int exit_code_;
};

[[nodiscard]] std::string escaped(const std::string_view value) {
	std::string output;
	for (const char character : value) {
		if (character == '\\' || character == '"') output += '\\';
		if (character == '\n') output += "\\n";
		else if (character == '\r') output += "\\r";
		else output += character;
	}
	return output;
}

[[nodiscard]] std::string ffmpeg_error(const int code) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> bytes{};
	av_strerror(code, bytes.data(), bytes.size());
	return std::string{bytes.data()};
}

void require_ffmpeg(const int status, const std::string_view action) {
	if (status < 0) throw sequence_decode_failure(
		"image-sequence-decode-failed", std::string{action} + ": " + ffmpeg_error(status)
	);
}

void cancelled() {
	if (media_cancellation_requested()) {
		throw sequence_decode_failure("cancelled", "The image-sequence decode was cancelled.", 75);
	}
}

class exclusive_pack_output final {
public:
	exclusive_pack_output(std::filesystem::path path, const std::uint64_t maximum)
		: path_{std::move(path)}, maximum_{maximum} {
#if defined(_WIN32)
		if (_wfopen_s(&file_, path_.c_str(), L"wbxN") != 0 || file_ == nullptr) {
#else
		file_ = std::fopen(path_.c_str(), "wbx");
		if (file_ == nullptr) {
#endif
			throw sequence_decode_failure("output-create", "The sequence output cannot be created exclusively.", 74);
		}
	}
	~exclusive_pack_output() {
		if (file_ != nullptr) std::fclose(file_);
		if (!committed_) { std::error_code ignored; std::filesystem::remove(path_, ignored); }
	}
	exclusive_pack_output(const exclusive_pack_output&) = delete;
	exclusive_pack_output& operator=(const exclusive_pack_output&) = delete;

	void write(const void* value, const std::size_t count) {
		if (count > maximum_ - high_water_
			|| (count > 0 && std::fwrite(value, 1, count, file_) != count)) {
			throw sequence_decode_failure("output-limit", "The sequence output exceeded its exact byte grant.", 74);
		}
		high_water_ += count;
	}
	void u32(const std::uint32_t value) { integer(value); }
	void u64(const std::uint64_t value) { integer(value); }
	void i64(const std::int64_t value) { integer(static_cast<std::uint64_t>(value)); }
	void patch_u32(const std::uint64_t offset, const std::uint32_t value) { patch(offset, value); }
	void patch_u64(const std::uint64_t offset, const std::uint64_t value) { patch(offset, value); }
	void flush() {
		if (std::fflush(file_) != 0) throw sequence_decode_failure("output-flush", "The sequence output cannot be flushed.", 74);
	}
	void commit() { flush(); committed_ = true; }
	[[nodiscard]] std::uint64_t byte_length() const noexcept { return high_water_; }
	[[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

private:
	template<typename Integer> void integer(const Integer value) {
		std::array<std::uint8_t, sizeof(Integer)> bytes{};
		for (std::size_t index = 0; index < bytes.size(); ++index) {
			bytes[index] = static_cast<std::uint8_t>(value >> (index * 8U));
		}
		write(bytes.data(), bytes.size());
	}
	template<typename Integer> void patch(const std::uint64_t offset, const Integer value) {
		if (offset > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
			throw sequence_decode_failure("output-seek", "The sequence output patch is outside its domain.", 74);
		}
#if defined(_WIN32)
		if (_fseeki64(file_, static_cast<std::int64_t>(offset), SEEK_SET) != 0) {
#else
		if (fseeko(file_, static_cast<off_t>(offset), SEEK_SET) != 0) {
#endif
			throw sequence_decode_failure("output-seek", "The sequence output cannot be patched.", 74);
		}
		std::array<std::uint8_t, sizeof(Integer)> bytes{};
		for (std::size_t index = 0; index < bytes.size(); ++index) {
			bytes[index] = static_cast<std::uint8_t>(value >> (index * 8U));
		}
		if (std::fwrite(bytes.data(), 1, bytes.size(), file_) != bytes.size()) {
			throw sequence_decode_failure("output-write", "The sequence output patch failed.", 74);
		}
#if defined(_WIN32)
		if (_fseeki64(file_, 0, SEEK_END) != 0) {
#else
		if (fseeko(file_, 0, SEEK_END) != 0) {
#endif
			throw sequence_decode_failure("output-seek", "The sequence output end cannot be restored.", 74);
		}
	}
	std::filesystem::path path_;
	std::uint64_t maximum_{};
	std::uint64_t high_water_{};
	std::FILE* file_{};
	bool committed_{};
};

struct decoder final {
	AVCodecContext* context{};
	AVPacket* packet{};
	AVFrame* frame{};
	decoder() = default;
	decoder(const decoder&) = delete;
	decoder& operator=(const decoder&) = delete;
	decoder(decoder&& other) noexcept
		: context{std::exchange(other.context, nullptr)},
		packet{std::exchange(other.packet, nullptr)},
		frame{std::exchange(other.frame, nullptr)} {}
	~decoder() { av_frame_free(&frame); av_packet_free(&packet); avcodec_free_context(&context); }
};

[[nodiscard]] AVCodecID codec_id(const image_sequence_profile profile) {
	if (profile == image_sequence_profile::png) return AV_CODEC_ID_PNG;
	if (profile == image_sequence_profile::tiff) return AV_CODEC_ID_TIFF;
	return AV_CODEC_ID_EXR;
}

[[nodiscard]] std::string_view profile_name(const image_sequence_profile profile) {
	if (profile == image_sequence_profile::png) return "decode-png-sequence";
	if (profile == image_sequence_profile::tiff) return "decode-tiff-sequence";
	return "decode-openexr-sequence";
}

[[nodiscard]] std::string_view policy_row(const image_sequence_profile profile) {
	if (profile == image_sequence_profile::png) return "codec-decode-png-image-sequence";
	if (profile == image_sequence_profile::tiff) return "codec-decode-tiff-image-sequence";
	return "codec-decode-openexr-image-sequence";
}

[[nodiscard]] decoder open_decoder(const image_sequence_profile profile) {
	decoder result;
	const auto* codec = avcodec_find_decoder(codec_id(profile));
	if (codec == nullptr) {
		throw sequence_decode_failure(
			"image-sequence-decoder-unavailable",
			"The pinned FFmpeg build does not provide the licensed still decoder.", 78
		);
	}
	result.context = avcodec_alloc_context3(codec);
	if (result.context == nullptr) throw sequence_decode_failure("decode-allocation", "The still decoder cannot be allocated.");
	result.context->thread_count = 1;
	result.context->max_pixels = 268'435'456;
	require_ffmpeg(avcodec_open2(result.context, codec, nullptr), "Open the still-image CPU decoder");
	result.packet = av_packet_alloc();
	result.frame = av_frame_alloc();
	if (result.packet == nullptr || result.frame == nullptr) {
		throw sequence_decode_failure("decode-allocation", "The still frame storage cannot be allocated.");
	}
	return result;
}

void read_frame_packet(
	std::ifstream& pack,
	AVPacket* packet,
	const admitted_image_sequence_frame& frame
) {
	if (frame.byte_length > static_cast<std::uint64_t>(std::numeric_limits<int>::max())
		|| frame.offset > static_cast<std::uint64_t>(std::numeric_limits<std::streamoff>::max())) {
		throw sequence_decode_failure("image-sequence-frame-limit", "A packed still exceeds the decoder packet domain.", 78);
	}
	pack.seekg(static_cast<std::streamoff>(frame.offset));
	if (!pack) throw sequence_decode_failure("source-read", "The source pack cannot seek to its frame.", 65);
	require_ffmpeg(av_new_packet(packet, static_cast<int>(frame.byte_length)), "Allocate a still-image packet");
	pack.read(reinterpret_cast<char*>(packet->data), static_cast<std::streamsize>(frame.byte_length));
	if (pack.gcount() != static_cast<std::streamsize>(frame.byte_length)
		|| sha256_bytes(packet->data, static_cast<std::size_t>(frame.byte_length)) != frame.sha256) {
		av_packet_unref(packet);
		throw sequence_decode_failure("source-changed", "A packed still changed after admission.", 65);
	}
}

[[nodiscard]] engine_result decode(const invocation& job, const admitted_image_sequence& sequence) {
	auto still_decoder = open_decoder(sequence.profile);
	std::ifstream pack{sequence.pack_path, std::ios::binary};
	if (!pack) throw sequence_decode_failure("source-read", "The authenticated source pack cannot be reopened.", 65);
	exclusive_pack_output output{job.decode_output, job.maximum_output_bytes};
	constexpr std::string_view magic_value = "framescaper-rgba-frame-pack-v1\n";
	output.write(magic_value.data(), magic_value.size());
	output.u32(1);
	const auto width_offset = magic_value.size() + sizeof(std::uint32_t);
	output.u32(0);
	const auto height_offset = width_offset + sizeof(std::uint32_t);
	output.u32(0);
	const auto count_offset = height_offset + sizeof(std::uint32_t);
	output.u64(0);
	output.u32(sequence.frame_rate_den);
	output.u32(sequence.frame_rate_num);
	int width{};
	int height{};
	AVPixelFormat pixel_format = AV_PIX_FMT_NONE;
	std::uint64_t frame_count{};
	for (const auto& admitted_frame : sequence.frames) {
		cancelled();
		read_frame_packet(pack, still_decoder.packet, admitted_frame);
		require_ffmpeg(avcodec_send_packet(still_decoder.context, still_decoder.packet), "Send a packed still");
		av_packet_unref(still_decoder.packet);
		require_ffmpeg(avcodec_receive_frame(still_decoder.context, still_decoder.frame), "Receive a packed still");
		if (width == 0) {
			width = still_decoder.frame->width;
			height = still_decoder.frame->height;
			pixel_format = static_cast<AVPixelFormat>(still_decoder.frame->format);
			if (width <= 0 || height <= 0) throw sequence_decode_failure("decode-geometry", "A still has invalid geometry.", 78);
		} else if (still_decoder.frame->width != width || still_decoder.frame->height != height
			|| still_decoder.frame->format != pixel_format) {
			throw sequence_decode_failure("image-sequence-format-change", "Sequence still geometry or pixel format changed.", 78);
		}
		const auto frame_bytes = av_image_get_buffer_size(AV_PIX_FMT_RGBA, width, height, 1);
		if (frame_bytes <= 0) throw sequence_decode_failure("decode-geometry", "The RGBA still size is invalid.", 78);
		std::vector<std::uint8_t> rgba(static_cast<std::size_t>(frame_bytes));
		std::array<std::uint8_t*, 4> planes{};
		std::array<int, 4> strides{};
		require_ffmpeg(av_image_fill_arrays(
			planes.data(), strides.data(), rgba.data(), AV_PIX_FMT_RGBA, width, height, 1
		), "Lay out one sequence RGBA frame");
		SwsContext* scaler = sws_getContext(
			width, height, pixel_format, width, height, AV_PIX_FMT_RGBA,
			SWS_BICUBIC, nullptr, nullptr, nullptr
		);
		if (scaler == nullptr) throw sequence_decode_failure("decode-scale", "RGBA still conversion is unavailable.", 78);
		const auto scaled = sws_scale(
			scaler, still_decoder.frame->data, still_decoder.frame->linesize,
			0, height, planes.data(), strides.data()
		);
		sws_freeContext(scaler);
		if (scaled != height) throw sequence_decode_failure("decode-scale", "RGBA still conversion was incomplete.", 70);
		output.u64(frame_count);
		output.i64(static_cast<std::int64_t>(frame_count));
		output.i64(1);
		output.u64(rgba.size());
		output.write(rgba.data(), rgba.size());
		++frame_count;
		av_frame_unref(still_decoder.frame);
		const auto second = avcodec_receive_frame(still_decoder.context, still_decoder.frame);
		if (second != AVERROR(EAGAIN) && second != AVERROR_EOF) {
			if (second >= 0) {
				av_frame_unref(still_decoder.frame);
				throw sequence_decode_failure("image-sequence-multi-frame", "One packed still decoded to multiple frames.", 78);
			}
			require_ffmpeg(second, "Drain a packed still");
		}
		avcodec_flush_buffers(still_decoder.context);
	}
	output.patch_u32(width_offset, static_cast<std::uint32_t>(width));
	output.patch_u32(height_offset, static_cast<std::uint32_t>(height));
	output.patch_u64(count_offset, frame_count);
	if (sha256_file(sequence.pack_path) != sequence.pack_sha256
		|| sha256_file(sequence.inventory_path) != sequence.inventory_sha256) {
		throw sequence_decode_failure("source-changed", "Sequence pack or inventory changed during decode.", 65);
	}
	output.flush();
	const auto output_sha256 = sha256_file(output.path());
	output.commit();
	std::ostringstream control;
	control << "{\"contractVersion\":1,\"operation\":\"media-decode\","
		<< "\"framePack\":\"framescaper-rgba-frame-pack-v1\",\"sourcePackVersion\":1,"
		<< "\"profile\":\"" << profile_name(sequence.profile) << "\","
		<< "\"frameCount\":" << frame_count << ",\"width\":" << width
		<< ",\"height\":" << height << ",\"exportAuthority\":\"image-sequence-source-pack\","
		<< "\"byteLength\":" << output.byte_length() << ",\"sha256\":\"" << output_sha256 << "\"}";
	return {0, control.str()};
}

} // namespace

engine_result execute_image_sequence_decode(const invocation& job) {
	if (!job.image_sequence) {
		return {78, "{\"error\":\"image-sequence-grant-missing\",\"operation\":\"media-decode\"}"};
	}
	if (!image_sequence_policy_enabled) {
		return {78, "{\"error\":\"image-sequence-licensing-unavailable\",\"operation\":\"media-decode\","
			"\"policyRow\":\"" + std::string{policy_row(job.image_sequence->profile)} + "\"}"};
	}
	try { return decode(job, *job.image_sequence); }
	catch (const sequence_decode_failure& error) {
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\"media-decode\","
			"\"detail\":\"" + escaped(error.what()) + "\"}"};
	} catch (const std::exception& error) {
		return {70, "{\"error\":\"image-sequence-native-failure\",\"operation\":\"media-decode\","
			"\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
