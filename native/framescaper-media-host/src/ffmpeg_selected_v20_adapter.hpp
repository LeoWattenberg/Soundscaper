/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "ffmpeg_media_engine.hpp"
#include "selected_v20_frame_executor.hpp"

#include <cstddef>
#include <optional>

namespace framescaper::media {

/** Execute one V7/V8 evaluated-RGBA carrier through the closed FFmpeg 9.0.1 mux. */
[[nodiscard]] engine_result execute_selected_v20_keyed_adapter(
	const invocation& job,
	const selected_v20_execution_plan& plan,
	std::size_t carrier_index,
	std::optional<std::size_t> audio_index
);

/** The adapter self-test is structural; codec presence is reported separately. */
[[nodiscard]] bool self_test_selected_v20_keyed_adapter() noexcept;

} // namespace framescaper::media
