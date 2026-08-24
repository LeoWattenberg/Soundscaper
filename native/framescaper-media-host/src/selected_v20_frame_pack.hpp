/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "selected_v20_frame_executor.hpp"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <istream>

namespace framescaper::media {

/** Authenticated, bounded sequential access over a file or live native RGBA pack. */
class selected_v20_frame_pack final {
public:
	selected_v20_frame_pack(
		const std::filesystem::path& path,
		std::uint64_t authenticated_byte_length
	);
	selected_v20_frame_pack(
		std::istream& input,
		std::uint64_t authenticated_byte_length
	);
	selected_v20_frame_pack(const selected_v20_frame_pack&) = delete;
	selected_v20_frame_pack& operator=(const selected_v20_frame_pack&) = delete;

	/** V7 carriers state one exact output picture for every selected cadence tick. */
	void require_output_cadence(const selected_v20_execution_plan& plan) const;
	[[nodiscard]] selected_v20_rgba_frame frame(std::uint64_t ordinal);
	[[nodiscard]] std::uint64_t frame_count() const noexcept { return frame_count_; }

private:
	void read_header();

	std::ifstream file_input_;
	std::istream* input_{};
	std::uint64_t byte_length_{};
	std::uint64_t bytes_read_{};
	std::uint32_t width_{};
	std::uint32_t height_{};
	std::uint32_t time_base_num_{};
	std::uint32_t time_base_den_{};
	std::uint64_t frame_bytes_{};
	std::uint64_t frame_count_{};
	std::uint64_t next_ordinal_{};
};

} // namespace framescaper::media
