/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_mp3_profile.h"

#include <array>
#include <cstddef>

namespace soundscaper::os_audio {
namespace {

constexpr std::array<uint32_t, 16u> mpeg1Layer3BitratesKbps{
	0u, 32u, 40u, 48u, 56u, 64u, 80u, 96u,
	112u, 128u, 160u, 192u, 224u, 256u, 320u, 0u,
};
constexpr std::array<uint32_t, 3u> mpeg1SampleRates{ 44100u, 48000u, 32000u };

uint32_t bigEndian32(const uint8_t *bytes)
{
	return static_cast<uint32_t>(bytes[0]) << 24u
		| static_cast<uint32_t>(bytes[1]) << 16u
		| static_cast<uint32_t>(bytes[2]) << 8u
		| static_cast<uint32_t>(bytes[3]);
}

bool id3v2Offset(const std::vector<uint8_t> &bytes, size_t &offset)
{
	offset = 0u;
	if (bytes.size() < 3u || bytes[0] != 'I' || bytes[1] != 'D' || bytes[2] != '3') return true;
	if (bytes.size() < 10u || bytes[3] < 2u || bytes[3] > 4u || bytes[4] == 0xffu
		|| bytes[6] >= 0x80u || bytes[7] >= 0x80u || bytes[8] >= 0x80u || bytes[9] >= 0x80u) {
		return false;
	}
	const size_t payload = static_cast<size_t>(bytes[6]) << 21u
		| static_cast<size_t>(bytes[7]) << 14u
		| static_cast<size_t>(bytes[8]) << 7u
		| static_cast<size_t>(bytes[9]);
	const size_t footer = (bytes[5] & 0x10u) == 0u ? 0u : 10u;
	if (payload > bytes.size() - 10u || footer > bytes.size() - 10u - payload) return false;
	offset = 10u + payload + footer;
	return true;
}

} // namespace

bool exactMp3(
	const std::vector<uint8_t> &bytes,
	uint32_t expectedSampleRate,
	uint32_t expectedChannelCount,
	uint32_t expectedBitrateKbps)
{
	if (bytes.empty() || expectedSampleRate == 0u
		|| expectedChannelCount < 1u || expectedChannelCount > 2u
		|| expectedBitrateKbps == 0u) return false;
	size_t offset = 0u;
	if (!id3v2Offset(bytes, offset)) return false;
	uint32_t frameCount = 0u;
	while (offset <= bytes.size() && bytes.size() - offset >= 4u) {
		const uint32_t header = bigEndian32(bytes.data() + offset);
		const uint32_t version = header >> 19u & 0x03u;
		const uint32_t layer = header >> 17u & 0x03u;
		const uint32_t bitrateIndex = header >> 12u & 0x0fu;
		const uint32_t sampleRateIndex = header >> 10u & 0x03u;
		if (header >> 21u != 0x7ffu || version != 3u || layer != 1u
			|| bitrateIndex == 0u || bitrateIndex == 0x0fu || sampleRateIndex == 3u) break;
		const uint32_t bitrateKbps = mpeg1Layer3BitratesKbps[bitrateIndex];
		const uint32_t sampleRate = mpeg1SampleRates[sampleRateIndex];
		const uint32_t channelCount = (header >> 6u & 0x03u) == 3u ? 1u : 2u;
		if (bitrateKbps != expectedBitrateKbps || sampleRate != expectedSampleRate
			|| channelCount != expectedChannelCount) return false;
		const uint32_t padding = header >> 9u & 0x01u;
		const size_t frameBytes = 144000u * bitrateKbps / sampleRate + padding;
		if (frameBytes < 4u || frameBytes > bytes.size() - offset) return false;
		offset += frameBytes;
		frameCount += 1u;
	}
	const bool id3v1 = bytes.size() - offset == 128u
		&& bytes[offset] == 'T' && bytes[offset + 1u] == 'A' && bytes[offset + 2u] == 'G';
	return frameCount >= 2u && (offset == bytes.size() || id3v1);
}

} // namespace soundscaper::os_audio
