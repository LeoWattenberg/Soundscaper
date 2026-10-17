/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <cstdint>
#include <istream>
#include <string>
#include <vector>

namespace motionscaper::media {
struct frame_identity final { std::string project_id; std::string revision_digest; std::string composition_id; };
struct frame_header final {
	frame_identity identity;
	std::uint32_t width{}, height{}, rate_num{}, rate_den{};
	std::uint64_t first_frame{}, frame_count{};
};
struct linear_frame final { std::uint32_t width{}, height{}; std::vector<float> pixels; };
class frame_carrier final {
public:
	frame_carrier(std::istream& input, std::uint64_t authenticated_length, const frame_identity& identity);
	[[nodiscard]] const frame_header& header() const noexcept { return header_; }
	[[nodiscard]] linear_frame read(std::uint64_t index);
private:
	std::istream& input_;
	frame_header header_;
	std::uint64_t next_{};
};
/** Convert unassociated Rec.709 samples only at the delivery boundary; alpha remains linear. */
[[nodiscard]] std::vector<std::uint16_t> rgba64_rec709(const linear_frame& input);
} // namespace motionscaper::media
