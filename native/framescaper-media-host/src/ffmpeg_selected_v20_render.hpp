/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "ffmpeg_media_engine.hpp"

namespace framescaper::media {

/** Report selected V7/V8 operation readiness separately from the general ABI self-test. */
[[nodiscard]] engine_result self_test_selected_v20_render();

/** Consume one authenticated V7/V8 snapshot and fail with its precise unbound runtime seam. */
[[nodiscard]] engine_result execute_selected_v20_render_job(const invocation& job);

} // namespace framescaper::media
