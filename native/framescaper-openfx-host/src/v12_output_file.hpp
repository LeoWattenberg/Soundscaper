/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace framescaper::openfx {

/** Exclusively publish one authenticated RGBA plane inside helper scratch. */
void publish_v12_output_file(
	const std::filesystem::path& path,
	const std::vector<unsigned char>& bytes,
	const std::string& sha256
);

} // namespace framescaper::openfx
