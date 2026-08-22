/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "ffmpeg_media_engine.hpp"

namespace framescaper::media {

/** Executes the exact one-source, one-full-frame-clip CPU subset. */
[[nodiscard]] engine_result execute_simple_render_job(const invocation& job);

} // namespace framescaper::media
