/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_WINDOWS_UTF8_PATH_FAKE_WINDOWS_H
#define SOUNDSCAPER_WINDOWS_UTF8_PATH_FAKE_WINDOWS_H

#include <wchar.h>

#define CP_UTF8 65001u
#define MB_ERR_INVALID_CHARS 8u

#ifdef __cplusplus
extern "C" {
#endif
extern int soundscaper_fake_fail_write;
int MultiByteToWideChar(unsigned int code_page, unsigned int flags,
	const char *source, int source_length, wchar_t *destination, int destination_capacity);
#ifdef __cplusplus
}
#endif

#endif
