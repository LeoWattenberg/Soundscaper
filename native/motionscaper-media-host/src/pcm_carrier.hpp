/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "frame_carrier.hpp"
namespace motionscaper::media {
inline constexpr std::uint64_t pcm_packet_samples = 4096;
inline constexpr std::uint64_t pcm_maximum_samples = 32768 * pcm_packet_samples;
struct pcm_header final { std::uint32_t sample_rate{}, channels{}; std::uint64_t sample_count{}; };
class pcm_carrier final {
public:
	pcm_carrier(std::istream& input, std::uint64_t authenticated_length, const frame_header& frames);
	[[nodiscard]] const pcm_header& header() const noexcept { return header_; }
	[[nodiscard]] std::vector<std::uint8_t> read(std::uint64_t sample_offset);
private:
	std::istream& input_; pcm_header header_; std::uint64_t next_{};
};
}
