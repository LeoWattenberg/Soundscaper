/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "selected_v20_frame_executor.hpp"

#include <string_view>

namespace framescaper::media {

/** Authenticated delivery intent that the selected V20 carrier cannot yet enact. */
struct selected_v20_caption_delivery final {
	bool mux{};
	bool burn_in{};
	bool sidecar{};

	[[nodiscard]] bool any() const noexcept { return mux || burn_in || sidecar; }
};

struct captured_selected_v20_execution_plan final {
	selected_v20_execution_plan execution;
	selected_v20_caption_delivery caption_delivery;
};

/** Capture execution-only V7/V8 authority from the immutable bytes already admitted by media_plan. */
[[nodiscard]] captured_selected_v20_execution_plan capture_selected_v20_execution_plan(
	int admitted_version,
	std::string_view authenticated_plan_json
);

} // namespace framescaper::media
