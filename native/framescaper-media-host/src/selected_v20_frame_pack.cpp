/* SPDX-License-Identifier: AGPL-3.0-only */

#include "selected_v20_frame_pack.hpp"

#include <array>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string_view>
#include <type_traits>
#include <utility>

namespace framescaper::media {
namespace {

inline constexpr std::string_view magic = "framescaper-rgba-frame-pack-v1\n";
inline constexpr std::uint64_t fixed_record_bytes = 32;

[[noreturn]] void invalid(const std::string_view detail) {
	throw selected_v20_execution_error(
		selected_v20_execution_error_code::frame_contract,
		"The evaluated RGBA frame pack is invalid: " + std::string{detail}
	);
}

template<typename Integer>
[[nodiscard]] Integer little_integer(std::ifstream& input) {
	std::array<std::uint8_t, sizeof(Integer)> bytes{};
	input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
	if (input.gcount() != static_cast<std::streamsize>(bytes.size())) invalid("a field is truncated.");
	using Unsigned = std::make_unsigned_t<Integer>;
	Unsigned result{};
	for (std::size_t index = 0; index < bytes.size(); ++index) {
		result |= static_cast<Unsigned>(bytes[index]) << (index * 8U);
	}
	return static_cast<Integer>(result);
}

[[nodiscard]] std::uint64_t position(std::ifstream& input) {
	const auto value = input.tellg();
	if (value < 0) invalid("its file position is unavailable.");
	return static_cast<std::uint64_t>(value);
}

} // namespace

selected_v20_frame_pack::selected_v20_frame_pack(
	const std::filesystem::path& path,
	const std::uint64_t authenticated_byte_length
) : path_{path}, input_{path, std::ios::binary}, byte_length_{authenticated_byte_length} {
	if (!input_) invalid("it cannot be opened.");
	if (byte_length_ < magic.size() + 28) invalid("its authenticated length is too short.");
	std::string observed(magic.size(), '\0');
	input_.read(observed.data(), static_cast<std::streamsize>(observed.size()));
	if (observed != magic) invalid("its magic does not match version 1.");
	if (little_integer<std::uint32_t>(input_) != 1) invalid("its version is unsupported.");
	width_ = little_integer<std::uint32_t>(input_);
	height_ = little_integer<std::uint32_t>(input_);
	const auto count = little_integer<std::uint64_t>(input_);
	time_base_num_ = little_integer<std::uint32_t>(input_);
	time_base_den_ = little_integer<std::uint32_t>(input_);
	const auto pixels = static_cast<std::uint64_t>(width_) * height_;
	if (width_ == 0 || height_ == 0 || pixels > selected_v20_maximum_frame_bytes / 4
		|| count == 0 || count > selected_v20_maximum_output_frames
		|| time_base_num_ == 0 || time_base_den_ == 0) {
		invalid("its header exceeds the selected-V20 bounds.");
	}
	frame_bytes_ = pixels * 4;
	if (count > (byte_length_ - position(input_)) / (fixed_record_bytes + frame_bytes_)) {
		invalid("its frame count exceeds its authenticated length.");
	}
	records_.reserve(static_cast<std::size_t>(count));
	for (std::uint64_t index = 0; index < count; ++index) {
		const auto ordinal = little_integer<std::uint64_t>(input_);
		const auto timestamp = little_integer<std::int64_t>(input_);
		const auto duration = little_integer<std::int64_t>(input_);
		const auto payload_bytes = little_integer<std::uint64_t>(input_);
		if (ordinal != index || payload_bytes != frame_bytes_) {
			invalid("a frame has the wrong ordinal or RGBA length.");
		}
		const auto payload_offset = position(input_);
		if (payload_offset > byte_length_ || frame_bytes_ > byte_length_ - payload_offset) {
			invalid("a frame payload is truncated.");
		}
		records_.push_back({ordinal, timestamp, duration, payload_offset});
		input_.seekg(static_cast<std::streamoff>(frame_bytes_), std::ios::cur);
		if (!input_) invalid("a frame payload cannot be skipped.");
	}
	if (position(input_) != byte_length_ || input_.peek() != std::char_traits<char>::eof()) {
		invalid("it has trailing or unauthenticated bytes.");
	}
	input_.clear();
}

void selected_v20_frame_pack::require_output_cadence(
	const selected_v20_execution_plan& plan
) const {
	if (width_ != plan.width || height_ != plan.height || records_.size() != plan.output_frame_count
		|| plan.output_rate.numerator() > std::numeric_limits<std::uint32_t>::max()
		|| plan.output_rate.denominator() > std::numeric_limits<std::uint32_t>::max()
		|| time_base_num_ != plan.output_rate.denominator().convert_to<std::uint32_t>()
		|| time_base_den_ != plan.output_rate.numerator().convert_to<std::uint32_t>()) {
		invalid("its geometry, count, or rational time base disagrees with the plan.");
	}
	for (const auto& record : records_) {
		if (record.timestamp < 0 || static_cast<std::uint64_t>(record.timestamp) != record.ordinal
			|| record.duration != 1) {
			invalid("its timestamps do not state one exact output cadence tick per frame.");
		}
	}
}

selected_v20_rgba_frame selected_v20_frame_pack::frame(const std::uint64_t ordinal) {
	if (ordinal >= records_.size()) invalid("a requested ordinal is outside the pack.");
	input_.clear();
	input_.seekg(static_cast<std::streamoff>(records_[static_cast<std::size_t>(ordinal)].payload_offset));
	if (!input_) invalid("a requested frame cannot be positioned.");
	std::vector<std::uint8_t> rgba(static_cast<std::size_t>(frame_bytes_));
	input_.read(reinterpret_cast<char*>(rgba.data()), static_cast<std::streamsize>(rgba.size()));
	if (input_.gcount() != static_cast<std::streamsize>(rgba.size())) invalid("a requested frame is short.");
	return {width_, height_, std::move(rgba)};
}

} // namespace framescaper::media
