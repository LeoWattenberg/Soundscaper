/* SPDX-License-Identifier: AGPL-3.0-only */

#include "delivery_fs_sha256.hpp"

namespace soundscaper::delivery_fs {

sha256::sha256() = default;

void sha256::update(std::span<const std::byte> bytes) {
	core_.update(bytes);
}

std::string sha256::finish_hex() {
	return core_.finish_hex();
}

} // namespace soundscaper::delivery_fs
