// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include "ffmpeg_media_engine.hpp"

namespace framescaper::media {

/** Encode one authenticated evaluated-RGBA carrier into an atomic image-sequence sibling. */
[[nodiscard]] engine_result execute_professional_image_sequence_encode(const invocation& job);

} // namespace framescaper::media
