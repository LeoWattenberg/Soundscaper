/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <filesystem>
#include <string>

namespace framescaper::openfx {

class DynamicLibrary {
public:
	DynamicLibrary(const std::filesystem::path& binary, const std::string& expected_sha256);
	~DynamicLibrary();
	DynamicLibrary(const DynamicLibrary&) = delete;
	DynamicLibrary& operator=(const DynamicLibrary&) = delete;

	void* required_symbol(const char* name) const;
	void* optional_symbol(const char* name) const;
	const std::filesystem::path& canonical_path() const { return path_; }
	const std::string& sha256() const { return sha256_; }

private:
	std::filesystem::path path_;
	std::string sha256_;
	void* handle_ = nullptr;
};

} // namespace framescaper::openfx
