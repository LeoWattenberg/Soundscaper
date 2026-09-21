/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_VAMP_EXACT_LIBRARY_H
#define SOUNDSCAPER_VAMP_EXACT_LIBRARY_H

#include <filesystem>
#include <memory>

namespace soundscaper::vamp::detail {

/** Direct loader for one already-authorized absolute library path. */
class ExactDynamicLibrary final {
public:
	ExactDynamicLibrary();
	~ExactDynamicLibrary();
	ExactDynamicLibrary(const ExactDynamicLibrary &) = delete;
	ExactDynamicLibrary &operator=(const ExactDynamicLibrary &) = delete;
	ExactDynamicLibrary(ExactDynamicLibrary &&) noexcept;
	ExactDynamicLibrary &operator=(ExactDynamicLibrary &&) noexcept;

	static bool isExactPath(const std::filesystem::path &path);
	bool open(const std::filesystem::path &path);
	void *symbol(const char *name) const;

private:
	struct Impl;
	std::unique_ptr<Impl> impl_;
};

} // namespace soundscaper::vamp::detail

#endif
