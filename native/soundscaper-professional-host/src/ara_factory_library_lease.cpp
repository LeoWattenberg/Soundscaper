/* SPDX-License-Identifier: AGPL-3.0-only */
#include "ara_factory_library_lease.h"

#if defined(_WIN32)
#include <windows.h>
#endif

namespace soundscaper {

AraFactoryLibraryLease::~AraFactoryLibraryLease()
{
#if defined(_WIN32)
	if (module != nullptr) FreeLibrary(static_cast<HMODULE>(module));
#endif
}

bool AraFactoryLibraryLease::retain(const void *codeAddress) noexcept
{
	if (codeAddress == nullptr) return false;
#if defined(_WIN32)
	HMODULE acquired = nullptr;
	// Resolve the already-loaded factory's code address, without another path
	// lookup. Unlike UNCHANGED_REFCOUNT, this acquires a balanced loader lease.
	if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
		reinterpret_cast<LPCWSTR>(codeAddress), &acquired)) return false;
	if (module != nullptr) FreeLibrary(static_cast<HMODULE>(module));
	module = acquired;
#endif
	return true;
}

}
