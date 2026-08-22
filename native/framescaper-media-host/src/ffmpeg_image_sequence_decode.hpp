// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include "ffmpeg_media_engine.hpp"

namespace framescaper::media {

/** Decode an authenticated PNG/TIFF/OpenEXR source pack to the bounded RGBA preview pack. */
[[nodiscard]] engine_result execute_image_sequence_decode(const invocation& job);

} // namespace framescaper::media
