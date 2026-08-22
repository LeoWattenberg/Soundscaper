/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <filesystem>
#include <string>

namespace framescaper::openfx {

std::string sha256_file(const std::filesystem::path& path);

} // namespace framescaper::openfx
