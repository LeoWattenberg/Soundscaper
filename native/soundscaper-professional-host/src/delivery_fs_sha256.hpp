/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "../../common/sha256.hpp"

#include <span>
#include <string>

namespace soundscaper::delivery_fs {

class sha256 final {
public:
	sha256();
	void update(std::span<const std::byte> bytes);
	std::string finish_hex();

private:
	scape::native_common::sha256 core_;
};

} // namespace soundscaper::delivery_fs
