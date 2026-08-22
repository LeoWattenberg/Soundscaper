/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "media_plan.hpp"
#include "strict_json.hpp"

namespace framescaper::media::legacy {

/** Authenticate the closed semantic authority retained for exact V7/V8 handoffs. */
void validate_legacy_plan(const json::value& root, admitted_media_plan& result);

} // namespace framescaper::media::legacy
