/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "frame_carrier.hpp"
#include "pcm_carrier.hpp"
#include <filesystem>

namespace motionscaper::media {
[[nodiscard]] bool prores_available() noexcept;
void encode_prores4444(frame_carrier& carrier, const std::filesystem::path& destination, pcm_carrier* audio = nullptr);
} // namespace motionscaper::media
