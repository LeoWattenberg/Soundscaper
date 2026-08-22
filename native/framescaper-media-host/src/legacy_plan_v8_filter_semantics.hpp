/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"

namespace framescaper::media::legacy {

/** Close and cross-check every duplicated authority in a V8 layered filter plan. */
void validate_v8_filter_plan(const json::value& root);

} // namespace framescaper::media::legacy
