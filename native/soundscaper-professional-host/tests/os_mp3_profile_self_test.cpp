/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_mp3_profile.h"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace {

void writeHeader(std::vector<uint8_t> &bytes, size_t offset, uint32_t bitrateIndex)
{
	const uint32_t header = 0xffe00000u | 3u << 19u | 1u << 17u | 1u << 16u
		| bitrateIndex << 12u | 1u << 10u;
	bytes[offset] = static_cast<uint8_t>(header >> 24u);
	bytes[offset + 1u] = static_cast<uint8_t>(header >> 16u);
	bytes[offset + 2u] = static_cast<uint8_t>(header >> 8u);
	bytes[offset + 3u] = static_cast<uint8_t>(header);
}

std::vector<uint8_t> exactFixture(bool id3)
{
	constexpr size_t frameBytes = 576u;
	const size_t prefix = id3 ? 10u : 0u;
	std::vector<uint8_t> bytes(prefix + frameBytes * 2u);
	if (id3) {
		bytes[0] = 'I'; bytes[1] = 'D'; bytes[2] = '3'; bytes[3] = 4u;
	}
	writeHeader(bytes, prefix, 11u);
	writeHeader(bytes, prefix + frameBytes, 11u);
	return bytes;
}

} // namespace

int main()
{
	const auto raw = exactFixture(false);
	const auto tagged = exactFixture(true);
	if (!soundscaper::os_audio::exactMp3(raw, 48000u, 2u, 192u)
		|| !soundscaper::os_audio::exactMp3(tagged, 48000u, 2u, 192u)
		|| soundscaper::os_audio::exactMp3(raw, 48000u, 2u, 160u)) return 1;
	auto trailing = raw;
	trailing.push_back(0u);
	if (soundscaper::os_audio::exactMp3(trailing, 48000u, 2u, 192u)) return 2;
	constexpr size_t firstFrameBytes = 576u;
	std::vector<uint8_t> mixed(firstFrameBytes + 480u);
	writeHeader(mixed, 0u, 11u);
	writeHeader(mixed, firstFrameBytes, 10u);
	return soundscaper::os_audio::exactMp3(mixed, 48000u, 2u, 192u) ? 3 : 0;
}
