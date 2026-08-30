/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string>

namespace soundscaper::delivery_fs {

class sha256 final {
public:
	sha256();
	void update(std::span<const std::byte> bytes);
	std::string finish_hex();

private:
	void transform(const std::byte* block);
	std::array<std::uint32_t, 8> state_;
	std::array<std::byte, 64> buffer_{};
	std::uint64_t total_bytes_ = 0;
	std::size_t buffered_bytes_ = 0;
	bool finished_ = false;
};

} // namespace soundscaper::delivery_fs
