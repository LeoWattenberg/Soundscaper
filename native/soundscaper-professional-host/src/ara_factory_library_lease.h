/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

namespace soundscaper {

/** Keeps the Windows module mapped until its ARA document and factory are gone. */
class AraFactoryLibraryLease final {
public:
	AraFactoryLibraryLease() = default;
	~AraFactoryLibraryLease();
	AraFactoryLibraryLease(const AraFactoryLibraryLease &) = delete;
	AraFactoryLibraryLease &operator=(const AraFactoryLibraryLease &) = delete;
	bool retain(const void *codeAddress) noexcept;

private:
	void *module = nullptr;
};

}
