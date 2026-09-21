/* SPDX-License-Identifier: AGPL-3.0-only */

#include "windows.h"

#include <string.h>

int soundscaper_fake_fail_write = 0;

int MultiByteToWideChar(unsigned int code_page, unsigned int flags,
	const char *source, int source_length, wchar_t *destination, int destination_capacity)
{
	if (code_page != CP_UTF8 || flags != MB_ERR_INVALID_CHARS || source == NULL) return 0;
	const int units = source_length == -1 ? (int)strlen(source) + 1 : source_length;
	if (units <= 0) return 0;
	for (int index = 0; index < units; ++index) {
		if ((unsigned char)source[index] >= 0x80u) return 0;
	}
	if (destination == NULL && destination_capacity == 0) return units;
	if (soundscaper_fake_fail_write || destination == NULL || destination_capacity < units) return 0;
	for (int index = 0; index < units; ++index) destination[index] = (wchar_t)source[index];
	return units;
}
