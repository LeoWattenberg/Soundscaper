// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>

namespace framescaper::media {

inline constexpr std::uint32_t helper_contract_version = 1;
inline constexpr std::size_t maximum_path_bytes = 4096;
inline constexpr std::size_t maximum_sources = 4096;

enum class operation {
	probe_video_source,
	media_decode,
	media_encode,
	media_render,
	media_proxy,
};

inline constexpr std::array<std::string_view, 5> operation_names = {
	"probe-video-source",
	"media-decode",
	"media-encode",
	"media-render",
	"media-proxy",
};

[[nodiscard]] constexpr std::optional<operation> parse_operation(
	const std::string_view value
) noexcept {
	for (std::size_t index = 0; index < operation_names.size(); ++index) {
		if (operation_names[index] == value) return static_cast<operation>(index);
	}
	return std::nullopt;
}

[[nodiscard]] constexpr std::string_view operation_name(
	const operation value
) noexcept {
	const auto index = static_cast<std::size_t>(value);
	return index < operation_names.size() ? operation_names[index] : std::string_view{};
}

} // namespace framescaper::media
