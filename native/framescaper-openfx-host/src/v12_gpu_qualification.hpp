/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "isolation_contract.hpp"
#include "../../framescaper-media-host/src/strict_json.hpp"

#include <vector>

namespace framescaper::openfx {

[[nodiscard]] std::vector<Backend> authenticate_v12_gpu_qualification(
	const framescaper::media::json::value& value
);

} // namespace framescaper::openfx
