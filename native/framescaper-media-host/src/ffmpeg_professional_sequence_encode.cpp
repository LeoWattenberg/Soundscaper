// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_professional_sequence_encode.hpp"
#include "ffmpeg_hardware_encode.hpp"
#include "selected_v20_frame_pack.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
}

#include <array>
#include <cerrno>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>

namespace framescaper::media {
namespace {

class sequence_encode_failure final : public std::runtime_error {
public:
	sequence_encode_failure(std::string code, std::string message, const int status = 70)
		: std::runtime_error(std::move(message)), code_{std::move(code)}, status_{status} {}
	[[nodiscard]] const std::string& code() const noexcept { return code_; }
	[[nodiscard]] int status() const noexcept { return status_; }
private:
	std::string code_;
	int status_;
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

[[nodiscard]] std::string ffmpeg_error(const int status) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> bytes{};
	av_strerror(status, bytes.data(), bytes.size());
	return std::string{bytes.data()};
}

void require(const int status, const std::string_view action) {
	if (status < 0) throw sequence_encode_failure(
		"image-sequence-encode-failed", std::string{action} + ": " + ffmpeg_error(status)
	);
}

void not_cancelled() {
	if (media_cancellation_requested()) {
		throw sequence_encode_failure("cancelled", "The image-sequence encode was cancelled.", 75);
	}
}

class sequence_directory final {
public:
	explicit sequence_directory(std::filesystem::path path) : path_{std::move(path)} {
		std::error_code error;
		if (!std::filesystem::create_directory(path_, error) || error) {
			throw sequence_encode_failure(
				"output-create", "The temporary image-sequence sibling could not be created exclusively.", 74
			);
		}
	}
	sequence_directory(const sequence_directory&) = delete;
	sequence_directory& operator=(const sequence_directory&) = delete;
	~sequence_directory() {
		if (!committed_) { std::error_code ignored; std::filesystem::remove_all(path_, ignored); }
	}
	void account(const std::uint64_t count, const std::uint64_t maximum) {
		if (count > maximum - bytes_) throw sequence_encode_failure(
			"output-limit", "The image sequence exceeded its exact output byte grant.", 74
		);
		bytes_ += count;
	}
	void commit() noexcept { committed_ = true; }
	[[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }
	[[nodiscard]] std::uint64_t bytes() const noexcept { return bytes_; }
private:
	std::filesystem::path path_;
	std::uint64_t bytes_{};
	bool committed_{};
};

class exclusive_frame final {
public:
	exclusive_frame(
		const std::filesystem::path& directory,
		const std::string& final_name,
		const std::uint64_t maximum
	) : part_{directory / (final_name + ".part")}, final_{directory / final_name}, maximum_{maximum} {
#if defined(_WIN32)
		if (_wfopen_s(&file_, part_.c_str(), L"wbxN") != 0 || file_ == nullptr) {
#else
		file_ = std::fopen(part_.c_str(), "wbx");
		if (file_ == nullptr) {
#endif
			throw sequence_encode_failure("output-create", "An image-sequence frame could not be created exclusively.", 74);
		}
	}
	exclusive_frame(const exclusive_frame&) = delete;
	exclusive_frame& operator=(const exclusive_frame&) = delete;
	~exclusive_frame() {
		if (file_ != nullptr) std::fclose(file_);
		if (!committed_) { std::error_code ignored; std::filesystem::remove(part_, ignored); }
	}
	void write(const std::uint8_t* data, const std::size_t count) {
		if (count > maximum_ - bytes_ || (count > 0 && std::fwrite(data, 1, count, file_) != count)) {
			throw sequence_encode_failure("output-limit", "An image-sequence frame exceeded its byte grant.", 74);
		}
		bytes_ += count;
	}
	void publish() {
		if (std::fflush(file_) != 0 || std::fclose(file_) != 0) {
			file_ = nullptr;
			throw sequence_encode_failure("output-flush", "An image-sequence frame could not be closed.", 74);
		}
		file_ = nullptr;
		std::error_code error;
		std::filesystem::rename(part_, final_, error);
		if (error) throw sequence_encode_failure("output-rename", "An image-sequence frame could not be atomically published.", 74);
		committed_ = true;
	}
	[[nodiscard]] std::uint64_t bytes() const noexcept { return bytes_; }
	[[nodiscard]] const std::filesystem::path& final_path() const noexcept { return final_; }
private:
	std::filesystem::path part_;
	std::filesystem::path final_;
	std::uint64_t maximum_{};
	std::uint64_t bytes_{};
	std::FILE* file_{};
	bool committed_{};
};

[[nodiscard]] std::size_t carrier_index(const invocation& job) {
	for (std::size_t index = 0; index < job.source_roles.size(); ++index) {
		if (job.source_roles[index] == "evaluated-rgba-frame-pack") return index;
	}
	throw sequence_encode_failure("carrier-missing", "Image-sequence export requires one evaluated RGBA carrier.", 65);
}

[[nodiscard]] std::string extension(const admitted_media_plan& plan) {
	if (plan.video_encoder == "png") return "png";
	if (plan.video_encoder == "tiff") return "tiff";
	if (plan.video_encoder == "exr") return "exr";
	throw sequence_encode_failure(
		"codec-policy-unavailable", "The image-sequence encoder is outside the closed registry.", 78
	);
}

[[nodiscard]] std::string frame_name(const std::uint64_t ordinal, const std::string& extension) {
	std::ostringstream output;
	output << "frame-" << std::setw(8) << std::setfill('0') << ordinal << '.' << extension;
	return output.str();
}

[[nodiscard]] std::unique_ptr<selected_v20_frame_pack> open_carrier(
	const invocation& job,
	const std::size_t index
) {
	if (job.source_stream_fds.at(index) == 0) {
		return std::make_unique<selected_v20_frame_pack>(
			std::cin, job.source_byte_lengths.at(index)
		);
	}
	if (job.source_stream_fds.at(index) >= 0) {
		throw sequence_encode_failure("carrier-fd", "The image-sequence carrier must use stdin or one authenticated file.", 65);
	}
	return std::make_unique<selected_v20_frame_pack>(
		job.sources.at(index), job.source_byte_lengths.at(index)
	);
}

[[nodiscard]] std::string manifest_line(
	const std::uint64_t ordinal,
	const std::string& name,
	const std::uint64_t byte_length,
	const std::string& sha256
) {
	return "{\"ordinal\":" + std::to_string(ordinal) + ",\"fileName\":\"" + name
		+ "\",\"byteLength\":" + std::to_string(byte_length) + ",\"sha256\":\"" + sha256 + "\"}";
}

void write_manifest(
	sequence_directory& directory,
	const invocation& job,
	const std::vector<std::string>& rows
) {
	exclusive_frame manifest{directory.path(), "manifest.json", job.maximum_output_bytes - directory.bytes()};
	const std::string prefix = "{\"schemaVersion\":1,\"profileId\":\"" + job.admitted_plan.professional_profile_id
		+ "\",\"frameCount\":" + std::to_string(rows.size()) + ",\"frames\":[";
	manifest.write(reinterpret_cast<const std::uint8_t*>(prefix.data()), prefix.size());
	for (std::size_t index = 0; index < rows.size(); ++index) {
		if (index > 0) { const std::uint8_t comma = ','; manifest.write(&comma, 1); }
		manifest.write(reinterpret_cast<const std::uint8_t*>(rows[index].data()), rows[index].size());
	}
	constexpr std::string_view suffix = "]}\n";
	manifest.write(reinterpret_cast<const std::uint8_t*>(suffix.data()), suffix.size());
	manifest.publish();
	directory.account(manifest.bytes(), job.maximum_output_bytes);
}

} // namespace

engine_result execute_professional_image_sequence_encode(const invocation& job) {
	const auto operation_text = std::string{operation_name(job.kind)};
	try {
		if (job.backend != "native-cpu") {
			return {78, "{\"error\":\"hardware-encoder-unavailable\",\"operation\":\"" + operation_text + "\","
				"\"requestedBackend\":\"" + job.backend + "\",\"fallbackBackend\":\"native-cpu\","
				"\"detail\":\"No image-sequence profile has a relabelled hardware encoder.\"}"};
		}
		const auto extension_value = extension(job.admitted_plan);
		const auto index = carrier_index(job);
		auto carrier = open_carrier(job, index);
		if (carrier->frame_count() != job.admitted_plan.output_frame_count) {
			throw sequence_encode_failure("carrier-cadence", "The carrier frame count disagrees with its image-sequence plan.", 65);
		}
		sequence_directory directory{job.temporary_output};
		auto encoder = ffmpeg_video_encode_session::open({
			job.admitted_plan, job.backend, job.admitted_plan.width, job.admitted_plan.height,
			{static_cast<int>(job.admitted_plan.frame_rate_den), static_cast<int>(job.admitted_plan.frame_rate_num)},
			{static_cast<int>(job.admitted_plan.frame_rate_num), static_cast<int>(job.admitted_plan.frame_rate_den)},
			false,
		});
		AVPacket* packet = av_packet_alloc();
		if (packet == nullptr) throw sequence_encode_failure("encode-allocation", "An image packet cannot be allocated.");
		std::vector<std::string> rows;
		rows.reserve(static_cast<std::size_t>(job.admitted_plan.output_frame_count));
		try {
			for (std::uint64_t ordinal = 0; ordinal < job.admitted_plan.output_frame_count; ++ordinal) {
				not_cancelled();
				auto source = carrier->frame(ordinal);
				const std::array<const std::uint8_t*, 4> planes{source.rgba.data(), nullptr, nullptr, nullptr};
				const std::array<int, 4> strides{static_cast<int>(source.width * 4U), 0, 0, 0};
				auto* frame = encoder->prepare(
					planes.data(), strides.data(), static_cast<int>(source.width), static_cast<int>(source.height),
					AV_PIX_FMT_RGBA, static_cast<std::int64_t>(ordinal), 1
				);
				require(avcodec_send_frame(encoder->context(), frame), "Send one image-sequence frame");
				const auto name = frame_name(ordinal, extension_value);
				exclusive_frame output{directory.path(), name, job.maximum_output_bytes - directory.bytes()};
				std::size_t packets = 0;
				while (true) {
					const auto status = avcodec_receive_packet(encoder->context(), packet);
					if (status == AVERROR(EAGAIN)) break;
					require(status, "Receive one encoded image");
					output.write(packet->data, static_cast<std::size_t>(packet->size));
					av_packet_unref(packet);
					++packets;
				}
				if (packets != 1) throw sequence_encode_failure(
					"image-packet-count", "An image encoder did not produce exactly one atomic frame packet.", 78
				);
				output.publish();
				directory.account(output.bytes(), job.maximum_output_bytes);
				rows.push_back(manifest_line(ordinal, name, output.bytes(), sha256_file(output.final_path())));
			}
		} catch (...) { av_packet_free(&packet); throw; }
		av_packet_free(&packet);
		write_manifest(directory, job, rows);
		const auto manifest_sha256 = sha256_file(directory.path() / "manifest.json");
		directory.commit();
		return {0, "{\"contractVersion\":1,\"operation\":\"" + operation_text + "\",\"profileId\":\""
			+ job.admitted_plan.professional_profile_id + "\",\"frameCount\":"
			+ std::to_string(rows.size()) + ",\"byteLength\":" + std::to_string(directory.bytes())
			+ ",\"manifestSha256\":\"" + manifest_sha256 + "\",\"publication\":\"temporary-directory\"}"};
	} catch (const ffmpeg_encode_failure& error) {
		return {error.exit_code(), "{\"error\":\"" + error.code() + "\",\"operation\":\"" + operation_text + "\",\"detail\":\""
			+ escaped(error.what()) + "\"}"};
	} catch (const sequence_encode_failure& error) {
		return {error.status(), "{\"error\":\"" + error.code() + "\",\"operation\":\"" + operation_text + "\",\"detail\":\""
			+ escaped(error.what()) + "\"}"};
	} catch (const std::exception& error) {
		return {70, "{\"error\":\"professional-sequence-encode-failure\",\"operation\":\"" + operation_text + "\",\"detail\":\""
			+ escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
