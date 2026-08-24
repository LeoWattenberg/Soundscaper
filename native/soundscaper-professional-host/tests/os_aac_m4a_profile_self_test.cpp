/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_aac_m4a_profile.h"

#include <cstdint>
#include <fstream>
#include <iterator>
#include <span>
#include <string>
#include <vector>

namespace {

std::vector<uint8_t> bytes(const char *path)
{
	std::ifstream input(path, std::ios::binary);
	return std::vector<uint8_t>(std::istreambuf_iterator<char>(input), {});
}

} // namespace

int main(int argc, char **argv)
{
	if (argc != 3) return 1;
	const auto lc = bytes(argv[1]);
	const auto he = bytes(argv[2]);
	if (lc.empty() || he.empty()) return 2;
	if (!soundscaper::os_audio::exactAacLcM4a(lc, 48000u, 2u)) return 3;
	if (soundscaper::os_audio::exactAacLcM4a(lc, 44100u, 2u)
		|| soundscaper::os_audio::exactAacLcM4a(lc, 48000u, 1u)) return 4;
	if (soundscaper::os_audio::exactAacLcM4a(he, 48000u, 2u)) return 5;
	return 0;
}
