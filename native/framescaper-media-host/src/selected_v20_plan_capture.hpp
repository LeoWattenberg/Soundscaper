/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "selected_v20_frame_executor.hpp"

#include <string_view>

namespace framescaper::media {

/** Capture execution-only V7/V8 authority from the immutable bytes already admitted by media_plan. */
[[nodiscard]] selected_v20_execution_plan capture_selected_v20_execution_plan(
	int admitted_version,
	std::string_view authenticated_plan_json
);

} // namespace framescaper::media
