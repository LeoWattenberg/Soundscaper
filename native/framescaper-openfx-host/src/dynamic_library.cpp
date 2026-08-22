/* SPDX-License-Identifier: AGPL-3.0-only */

#include "dynamic_library.hpp"

#include "isolation_contract.hpp"
#include "sha256.hpp"

#include <stdexcept>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace framescaper::openfx {
namespace {

void* open_library(const std::filesystem::path& path) {
#ifdef _WIN32
	return reinterpret_cast<void*>(LoadLibraryExW(
		path.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32
	));
#else
	return dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
}

void close_library(void* handle) {
#ifdef _WIN32
	if (handle != nullptr) FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
	if (handle != nullptr) dlclose(handle);
#endif
}

void* find_symbol(void* handle, const char* name) {
#ifdef _WIN32
	return reinterpret_cast<void*>(GetProcAddress(reinterpret_cast<HMODULE>(handle), name));
#else
	return dlsym(handle, name);
#endif
}

} // namespace

DynamicLibrary::DynamicLibrary(
	const std::filesystem::path& binary,
	const std::string& expected_sha256
) {
	require_os_isolation_for_plugin_execution();
	if (!valid_digest(expected_sha256) || !binary.is_absolute()) {
		throw std::invalid_argument("The OpenFX load grant must bind an absolute path and canonical digest.");
	}
	const auto status = std::filesystem::symlink_status(binary);
	if (!std::filesystem::is_regular_file(status) || std::filesystem::is_symlink(status)) {
		throw std::invalid_argument("The OpenFX load grant must name one regular non-symlink binary.");
	}
	path_ = std::filesystem::canonical(binary);
	const auto before_size = std::filesystem::file_size(path_);
	const auto before_write = std::filesystem::last_write_time(path_);
	sha256_ = sha256_file(path_);
	if (sha256_ != expected_sha256) {
		throw std::runtime_error("The OpenFX binary digest did not authenticate before loading.");
	}
	handle_ = open_library(path_);
	if (handle_ == nullptr) throw std::runtime_error("The authenticated OpenFX binary could not be loaded.");
	try {
		if (std::filesystem::file_size(path_) != before_size
			|| std::filesystem::last_write_time(path_) != before_write
			|| sha256_file(path_) != sha256_) {
			throw std::runtime_error("The OpenFX binary changed across authenticated loading.");
		}
	} catch (...) {
		close_library(handle_);
		handle_ = nullptr;
		throw;
	}
}

DynamicLibrary::~DynamicLibrary() {
	close_library(handle_);
}

void* DynamicLibrary::required_symbol(const char* name) const {
	if (const auto symbol = optional_symbol(name); symbol != nullptr) return symbol;
	throw std::runtime_error(std::string{"The OpenFX binary is missing required entry point "} + name + '.');
}

void* DynamicLibrary::optional_symbol(const char* name) const {
	return find_symbol(handle_, name);
}

} // namespace framescaper::openfx
