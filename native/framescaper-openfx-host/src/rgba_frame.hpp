/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <cstddef>
#include <limits>
#include <vector>

namespace framescaper::openfx {

inline constexpr std::size_t kMaximumRgbaFrameDimension = 16'384;
inline constexpr std::size_t kMaximumRgbaFrameRowBytes = 64U * 1'024U;
inline constexpr std::size_t kMaximumRgbaFrameBytes = 256U * 1'024U * 1'024U;
inline constexpr std::size_t kMaximumRgbaFrameSetBytes = 512U * 1'024U * 1'024U;

struct RgbaFrameLayout final {
	std::size_t width{1};
	std::size_t height{1};
	std::size_t row_bytes{4};
	std::size_t byte_length{4};
};

struct RgbaFrame final {
	RgbaFrameLayout layout;
	std::vector<unsigned char> rgba{4, 0};
};

[[nodiscard]] inline bool valid_rgba_frame_layout(const RgbaFrameLayout& value) {
	return value.width >= 1 && value.width <= kMaximumRgbaFrameDimension
		&& value.height >= 1 && value.height <= kMaximumRgbaFrameDimension
		&& value.row_bytes >= value.width * 4U
		&& value.row_bytes <= kMaximumRgbaFrameRowBytes
		&& value.row_bytes % 4U == 0
		&& value.height <= std::numeric_limits<std::size_t>::max() / value.row_bytes
		&& value.byte_length == value.row_bytes * value.height
		&& value.byte_length <= kMaximumRgbaFrameBytes;
}

} // namespace framescaper::openfx
