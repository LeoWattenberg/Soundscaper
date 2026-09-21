/* SPDX-License-Identifier: AGPL-3.0-only */

#include "../../native/common/windows_utf8_path.h"

#include <string>

int main()
{
	std::wstring path;
	if (!soundscaper::windows_path::decode_bounded_path(path, "C:/music.mp3")
		|| path != L"C:/music.mp3") return 1;
	const std::string explicit_bytes{"a\0b", 3};
	if (!soundscaper::windows_path::decode(path, explicit_bytes.data(), 3, 1, 32768, false)
		|| path.size() != 3 || path[0] != L'a' || path[1] != L'\0' || path[2] != L'b') return 2;
	if (soundscaper::windows_path::decode_bounded_path(path, "")) return 3;
	if (soundscaper::windows_path::decode(path, "xx", -1, 2, 2, true)) return 4;
	soundscaper_fake_fail_write = 1;
	if (soundscaper::windows_path::decode(path, "x", -1, 1, 32768, true)) return 5;
	return 0;
}
