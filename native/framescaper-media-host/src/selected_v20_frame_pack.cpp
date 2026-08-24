/* SPDX-License-Identifier: AGPL-3.0-only */

#include "selected_v20_frame_pack.hpp"

#include <array>
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
[[nodiscard]] Integer little_integer(std::istream& input) {
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

} // namespace

selected_v20_frame_pack::selected_v20_frame_pack(
	const std::filesystem::path& path,
	const std::uint64_t authenticated_byte_length
) : file_input_{path, std::ios::binary}, input_{&file_input_}, byte_length_{authenticated_byte_length} {
	if (!file_input_) invalid("it cannot be opened.");
	read_header();
}

selected_v20_frame_pack::selected_v20_frame_pack(
	std::istream& input,
	const std::uint64_t authenticated_byte_length
) : input_{&input}, byte_length_{authenticated_byte_length} {
	read_header();
}

void selected_v20_frame_pack::read_header() {
	if (byte_length_ < magic.size() + 28) invalid("its authenticated length is too short.");
	std::string observed(magic.size(), '\0');
	input_->read(observed.data(), static_cast<std::streamsize>(observed.size()));
	if (observed != magic) invalid("its magic does not match version 1.");
	if (little_integer<std::uint32_t>(*input_) != 1) invalid("its version is unsupported.");
	width_ = little_integer<std::uint32_t>(*input_);
	height_ = little_integer<std::uint32_t>(*input_);
	frame_count_ = little_integer<std::uint64_t>(*input_);
	time_base_num_ = little_integer<std::uint32_t>(*input_);
	time_base_den_ = little_integer<std::uint32_t>(*input_);
	bytes_read_ = magic.size() + 28;
	const auto pixels = static_cast<std::uint64_t>(width_) * height_;
	if (width_ == 0 || height_ == 0 || pixels > selected_v20_maximum_frame_bytes / 4
		|| frame_count_ == 0 || frame_count_ > selected_v20_maximum_output_frames
		|| time_base_num_ == 0 || time_base_den_ == 0) {
		invalid("its header exceeds the selected-V20 bounds.");
	}
	frame_bytes_ = pixels * 4;
	const auto record_bytes = fixed_record_bytes + frame_bytes_;
	if (frame_count_ > (std::numeric_limits<std::uint64_t>::max() - bytes_read_) / record_bytes
		|| bytes_read_ + frame_count_ * record_bytes != byte_length_) {
		invalid("its frame count disagrees with its authenticated exact length.");
	}
}

void selected_v20_frame_pack::require_output_cadence(
	const selected_v20_execution_plan& plan
) const {
	if (width_ != plan.width || height_ != plan.height || frame_count_ != plan.output_frame_count
		|| plan.output_rate.numerator() > std::numeric_limits<std::uint32_t>::max()
		|| plan.output_rate.denominator() > std::numeric_limits<std::uint32_t>::max()
		|| time_base_num_ != plan.output_rate.denominator().convert_to<std::uint32_t>()
		|| time_base_den_ != plan.output_rate.numerator().convert_to<std::uint32_t>()) {
		invalid("its geometry, count, or rational time base disagrees with the plan.");
	}
}

selected_v20_rgba_frame selected_v20_frame_pack::frame(const std::uint64_t ordinal) {
	if (ordinal != next_ordinal_ || ordinal >= frame_count_) {
		invalid("frames must be requested once in their exact sequential order.");
	}
	const auto observed_ordinal = little_integer<std::uint64_t>(*input_);
	const auto timestamp = little_integer<std::int64_t>(*input_);
	const auto duration = little_integer<std::int64_t>(*input_);
	const auto payload_bytes = little_integer<std::uint64_t>(*input_);
	bytes_read_ += fixed_record_bytes;
	if (observed_ordinal != ordinal || timestamp < 0
		|| static_cast<std::uint64_t>(timestamp) != ordinal || duration != 1
		|| payload_bytes != frame_bytes_) {
		invalid("a frame disagrees with its ordinal, cadence tick, or RGBA length.");
	}
	std::vector<std::uint8_t> rgba(static_cast<std::size_t>(frame_bytes_));
	input_->read(reinterpret_cast<char*>(rgba.data()), static_cast<std::streamsize>(rgba.size()));
	if (input_->gcount() != static_cast<std::streamsize>(rgba.size())) invalid("a requested frame is short.");
	bytes_read_ += frame_bytes_; ++next_ordinal_;
	if (next_ordinal_ == frame_count_ && bytes_read_ != byte_length_) {
		invalid("its final frame did not consume the authenticated exact length.");
	}
	return {width_, height_, std::move(rgba)};
}

} // namespace framescaper::media
