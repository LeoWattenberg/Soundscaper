/* SPDX-License-Identifier: AGPL-3.0-only */

#include "vamp_exact_library.h"

#include <utility>

#if defined(_WIN32)
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace soundscaper::vamp::detail {

struct ExactDynamicLibrary::Impl {
#if defined(_WIN32)
	HMODULE handle = nullptr;
#else
	void *handle = nullptr;
#endif
	~Impl()
	{
		if (handle == nullptr) return;
#if defined(_WIN32)
		FreeLibrary(handle);
#else
		dlclose(handle);
#endif
	}
};

ExactDynamicLibrary::ExactDynamicLibrary() : impl_(std::make_unique<Impl>()) {}
ExactDynamicLibrary::~ExactDynamicLibrary() = default;
ExactDynamicLibrary::ExactDynamicLibrary(ExactDynamicLibrary &&) noexcept = default;
ExactDynamicLibrary &ExactDynamicLibrary::operator=(ExactDynamicLibrary &&) noexcept = default;

bool ExactDynamicLibrary::isExactPath(const std::filesystem::path &path)
{
	return !path.empty() && path.is_absolute() && path.lexically_normal() == path;
}

bool ExactDynamicLibrary::open(const std::filesystem::path &path)
{
	if (!isExactPath(path) || impl_->handle != nullptr) return false;
#if defined(_WIN32)
	impl_->handle = LoadLibraryExW(path.c_str(), nullptr,
		LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
#else
	impl_->handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
	return impl_->handle != nullptr;
}

void *ExactDynamicLibrary::symbol(const char *name) const
{
	if (impl_->handle == nullptr || name == nullptr) return nullptr;
#if defined(_WIN32)
	return reinterpret_cast<void *>(GetProcAddress(impl_->handle, name));
#else
	return dlsym(impl_->handle, name);
#endif
}

} // namespace soundscaper::vamp::detail

