/* SPDX-License-Identifier: AGPL-3.0-only */

#include "sha256.hpp"
#include "../../common/sha256.hpp"

#include <array>
#include <cstddef>
#include <fstream>
#include <span>
#include <stdexcept>

namespace framescaper::openfx {

std::string sha256_file(const std::filesystem::path& path) {
	std::ifstream input(path, std::ios::binary);
	if (!input) throw std::runtime_error("The authenticated OpenFX binary cannot be opened.");
	scape::native_common::sha256 digest;
	std::array<char, 64 * 1024> bytes{};
	while (input) {
		input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
		const auto count = input.gcount();
		if (count > 0) digest.update(std::as_bytes(
			std::span(bytes.data(), static_cast<std::size_t>(count))
		));
	}
	if (!input.eof()) throw std::runtime_error("The authenticated OpenFX binary could not be read completely.");
	return digest.finish_hex();
}

} // namespace framescaper::openfx
