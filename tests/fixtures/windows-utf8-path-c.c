/* SPDX-License-Identifier: AGPL-3.0-only */

#include "../../native/common/windows_utf8_path.h"

#include <stdlib.h>
#include <wchar.h>

int main(void)
{
	int units = -1;
	wchar_t *owned = soundscaper_windows_wide_path_alloc("C:/audio.wav", -1, 1, 32768, &units);
	if (owned == NULL || units != 13 || wcscmp(owned, L"C:/audio.wav") != 0) return 1;
	free(owned);
	owned = soundscaper_windows_wide_path_alloc_nul("");
	if (owned == NULL || owned[0] != L'\0') return 7;
	free(owned);
	owned = soundscaper_windows_wide_path_alloc("", -1, 2, 32768, &units);
	if (owned != NULL) return 2;
	owned = soundscaper_windows_wide_path_alloc("x", -1, 2, 2, &units);
	if (owned == NULL || units != 2) return 3;
	free(owned);
	owned = soundscaper_windows_wide_path_alloc("xy", -1, 2, 2, &units);
	if (owned != NULL) return 4;
	const char invalid[] = {(char)0xff, 0};
	owned = soundscaper_windows_wide_path_alloc(invalid, -1, 1, 32768, &units);
	if (owned != NULL) return 5;
	soundscaper_fake_fail_write = 1;
	owned = soundscaper_windows_wide_path_alloc("x", -1, 1, 32768, &units);
	if (owned != NULL) return 6;
	return 0;
}
