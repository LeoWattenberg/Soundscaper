/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_WINDOWS_UTF8_PATH_H
#define SOUNDSCAPER_WINDOWS_UTF8_PATH_H

#include <limits.h>
#include <stdlib.h>
#include <wchar.h>
#include <windows.h>

/* source_length is -1 for NUL-terminated paths, or an exact byte count. Bounds
 * are measured in UTF-16 units, including the terminator only for -1. */
static inline int soundscaper_windows_wide_path_units(
	const char *source, int source_length, int minimum_units, int maximum_units)
{
	if (source == NULL || minimum_units < 1 || maximum_units < minimum_units) return 0;
	const int units = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
		source, source_length, NULL, 0);
	return units >= minimum_units && units <= maximum_units ? units : 0;
}

static inline int soundscaper_windows_wide_path_write(
	const char *source, int source_length, wchar_t *destination, int units)
{
	return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
		source, source_length, destination, units) == units;
}

/* The C caller owns the returned calloc allocation and releases it with free. */
static inline wchar_t *soundscaper_windows_wide_path_alloc(
	const char *source, int source_length, int minimum_units, int maximum_units, int *output_units)
{
	const int units = soundscaper_windows_wide_path_units(
		source, source_length, minimum_units, maximum_units);
	if (units == 0) return NULL;
	wchar_t *wide = (wchar_t *)calloc((size_t)units, sizeof(*wide));
	if (wide == NULL) return NULL;
	if (!soundscaper_windows_wide_path_write(source, source_length, wide, units)) {
		free(wide);
		return NULL;
	}
	if (output_units != NULL) *output_units = units;
	return wide;
}

static inline wchar_t *soundscaper_windows_wide_path_alloc_nul(const char *source)
{
	return soundscaper_windows_wide_path_alloc(source, -1, 1, INT_MAX, NULL);
}

#ifdef __cplusplus
#include <string>

namespace soundscaper::windows_path {

/* The C++ caller keeps its original std::wstring allocation/exception policy. */
inline bool decode(std::wstring &result, const char *source, const int source_length,
	const int minimum_units, const int maximum_units, const bool nul_terminated)
{
	const int units = soundscaper_windows_wide_path_units(
		source, source_length, minimum_units, maximum_units);
	if (units == 0) return false;
	result.resize(static_cast<std::size_t>(units));
	if (!soundscaper_windows_wide_path_write(source, source_length, result.data(), units)) return false;
	if (nul_terminated) result.pop_back();
	return true;
}

inline bool decode_bounded_path(std::wstring &result, const char *source)
{
	return decode(result, source, -1, 2, 32768, true);
}

} // namespace soundscaper::windows_path
#endif

#endif
