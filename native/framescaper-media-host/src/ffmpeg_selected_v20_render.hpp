/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "ffmpeg_media_engine.hpp"

namespace framescaper::media {

/** Report selected V7/V8 operation readiness separately from the general ABI self-test. */
[[nodiscard]] engine_result self_test_selected_v20_render();

/** Report selected V28/V14 carrier readiness under its own operation receipt. */
[[nodiscard]] engine_result self_test_selected_v28_v14_render();

/** Consume one authenticated V7/V8 snapshot and fail with its precise unbound runtime seam. */
[[nodiscard]] engine_result execute_selected_v20_render_job(const invocation& job);

/** Encode an authenticated V14 Web/evaluated-RGBA carrier through the same closed mux. */
[[nodiscard]] engine_result execute_v14_evaluated_rgba_render_job(const invocation& job);

} // namespace framescaper::media
