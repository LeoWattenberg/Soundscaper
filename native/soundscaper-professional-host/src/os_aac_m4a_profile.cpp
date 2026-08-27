/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_aac_m4a_profile.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <limits>
#include <span>
#include <vector>

namespace soundscaper::os_audio {
namespace {

constexpr uint32_t boxType(char a, char b, char c, char d)
{
	return static_cast<uint32_t>(static_cast<uint8_t>(a)) << 24u
		| static_cast<uint32_t>(static_cast<uint8_t>(b)) << 16u
		| static_cast<uint32_t>(static_cast<uint8_t>(c)) << 8u
		| static_cast<uint32_t>(static_cast<uint8_t>(d));
}

constexpr uint32_t ftyp = boxType('f', 't', 'y', 'p');
constexpr uint32_t moov = boxType('m', 'o', 'o', 'v');
constexpr uint32_t trak = boxType('t', 'r', 'a', 'k');
constexpr uint32_t mdia = boxType('m', 'd', 'i', 'a');
constexpr uint32_t hdlr = boxType('h', 'd', 'l', 'r');
constexpr uint32_t minf = boxType('m', 'i', 'n', 'f');
constexpr uint32_t stbl = boxType('s', 't', 'b', 'l');
constexpr uint32_t stsd = boxType('s', 't', 's', 'd');
constexpr uint32_t mp4a = boxType('m', 'p', '4', 'a');
constexpr uint32_t esds = boxType('e', 's', 'd', 's');
constexpr uint32_t soun = boxType('s', 'o', 'u', 'n');
constexpr uint32_t m4aBrand = boxType('M', '4', 'A', ' ');

struct Box {
	uint32_t type = 0u;
	size_t payload = 0u;
	size_t end = 0u;
};

struct Descriptor {
	uint8_t tag = 0u;
	size_t payload = 0u;
	size_t end = 0u;
};

struct TrackInspection {
	bool valid = false;
	bool audio = false;
	bool exact = false;
};

uint16_t unsigned16(std::span<const uint8_t> input, size_t offset)
{
	return static_cast<uint16_t>(static_cast<uint16_t>(input[offset]) << 8u
		| static_cast<uint16_t>(input[offset + 1u]));
}

uint32_t unsigned32(std::span<const uint8_t> input, size_t offset)
{
	return static_cast<uint32_t>(input[offset]) << 24u
		| static_cast<uint32_t>(input[offset + 1u]) << 16u
		| static_cast<uint32_t>(input[offset + 2u]) << 8u
		| static_cast<uint32_t>(input[offset + 3u]);
}

uint64_t unsigned64(std::span<const uint8_t> input, size_t offset)
{
	return static_cast<uint64_t>(unsigned32(input, offset)) << 32u
		| static_cast<uint64_t>(unsigned32(input, offset + 4u));
}

bool nextBox(
	std::span<const uint8_t> input,
	size_t &offset,
	size_t end,
	Box &result)
{
	if (offset > end || end > input.size() || end - offset < 8u) return false;
	const size_t start = offset;
	uint64_t bytes = unsigned32(input, start);
	size_t headerBytes = 8u;
	if (bytes == 1u) {
		if (end - start < 16u) return false;
		bytes = unsigned64(input, start + 8u);
		headerBytes = 16u;
	} else if (bytes == 0u) {
		bytes = end - start;
	}
	if (bytes < headerBytes || bytes > end - start
		|| bytes > std::numeric_limits<size_t>::max()) return false;
	const size_t boxBytes = static_cast<size_t>(bytes);
	result = Box{ unsigned32(input, start + 4u), start + headerBytes, start + boxBytes };
	offset = result.end;
	return true;
}

template <typename Visitor>
bool visitBoxes(
	std::span<const uint8_t> input,
	size_t start,
	size_t end,
	Visitor visitor)
{
	if (start > end || end > input.size()) return false;
	size_t offset = start;
	while (offset < end) {
		Box box{};
		if (!nextBox(input, offset, end, box) || !visitor(box)) return false;
	}
	return offset == end;
}

bool descriptor(
	std::span<const uint8_t> input,
	size_t offset,
	size_t end,
	Descriptor &result)
{
	if (offset >= end || end > input.size()) return false;
	const uint8_t tag = input[offset++];
	size_t bytes = 0u;
	bool complete = false;
	for (size_t index = 0u; index < 4u; ++index) {
		if (offset >= end || bytes > (std::numeric_limits<size_t>::max() >> 7u)) return false;
		const uint8_t value = input[offset++];
		bytes = bytes << 7u | static_cast<size_t>(value & 0x7fu);
		if ((value & 0x80u) == 0u) { complete = true; break; }
	}
	if (!complete || bytes > end - offset) return false;
	result = Descriptor{ tag, offset, offset + bytes };
	return true;
}

class BitReader {
public:
	explicit BitReader(std::span<const uint8_t> bytes) : bytes_(bytes) {}

	bool read(size_t count, uint32_t &result)
	{
		if (count > 32u || count > remaining()) return false;
		result = 0u;
		for (size_t index = 0u; index < count; ++index) {
			const size_t bit = position_++;
			result = result << 1u | static_cast<uint32_t>(
				bytes_[bit / 8u] >> (7u - bit % 8u) & 1u);
		}
		return true;
	}

	[[nodiscard]] size_t remaining() const { return bytes_.size() * 8u - position_; }

	bool remainingZero()
	{
		uint32_t value = 0u;
		while (remaining() > 0u) {
			if (!read(1u, value) || value != 0u) return false;
		}
		return true;
	}

private:
	std::span<const uint8_t> bytes_;
	size_t position_ = 0u;
};

bool exactAudioSpecificConfig(
	std::span<const uint8_t> config,
	uint32_t expectedSampleRate,
	uint32_t expectedChannelCount)
{
	static constexpr std::array<uint32_t, 13u> sampleRates{
		96000u, 88200u, 64000u, 48000u, 44100u, 32000u, 24000u,
		22050u, 16000u, 12000u, 11025u, 8000u, 7350u,
	};
	BitReader bits(config);
	uint32_t audioObjectType = 0u;
	uint32_t frequencyIndex = 0u;
	uint32_t channelConfiguration = 0u;
	if (!bits.read(5u, audioObjectType) || audioObjectType != 2u
		|| !bits.read(4u, frequencyIndex)) return false;
	uint32_t sampleRate = 0u;
	if (frequencyIndex == 15u) {
		if (!bits.read(24u, sampleRate)) return false;
	} else {
		if (frequencyIndex >= sampleRates.size()) return false;
		sampleRate = sampleRates[frequencyIndex];
	}
	uint32_t frameLength = 0u;
	uint32_t dependsOnCoreCoder = 0u;
	uint32_t extensionFlag = 0u;
	if (!bits.read(4u, channelConfiguration)
		|| !bits.read(1u, frameLength)
		|| !bits.read(1u, dependsOnCoreCoder)
		|| !bits.read(1u, extensionFlag)
		|| sampleRate != expectedSampleRate || channelConfiguration != expectedChannelCount
		|| frameLength != 0u || dependsOnCoreCoder != 0u || extensionFlag != 0u) return false;
	BitReader trailing = bits;
	if (trailing.remainingZero()) return true;
	uint32_t syncExtension = 0u;
	uint32_t extensionObjectType = 0u;
	uint32_t sbrPresent = 0u;
	return bits.read(11u, syncExtension) && syncExtension == 0x2b7u
		&& bits.read(5u, extensionObjectType) && extensionObjectType == 5u
		&& bits.read(1u, sbrPresent) && sbrPresent == 0u
		&& bits.remainingZero();
}

bool exactEsds(
	std::span<const uint8_t> input,
	const Box &box,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	if (box.end - box.payload < 4u || unsigned32(input, box.payload) != 0u) return false;
	Descriptor es{};
	if (!descriptor(input, box.payload + 4u, box.end, es)
		|| es.tag != 0x03u || es.end != box.end || es.end - es.payload < 3u) return false;
	size_t offset = es.payload + 2u;
	const uint8_t flags = input[offset++];
	if ((flags & 0x80u) != 0u) {
		if (es.end - offset < 2u) return false;
		offset += 2u;
	}
	if ((flags & 0x40u) != 0u) {
		if (offset >= es.end) return false;
		const size_t urlBytes = input[offset++];
		if (urlBytes > es.end - offset) return false;
		offset += urlBytes;
	}
	if ((flags & 0x20u) != 0u) {
		if (es.end - offset < 2u) return false;
		offset += 2u;
	}
	Descriptor decoder{};
	if (!descriptor(input, offset, es.end, decoder) || decoder.tag != 0x04u
		|| decoder.end - decoder.payload < 13u || input[decoder.payload] != 0x40u
		|| input[decoder.payload + 1u] != 0x15u) return false;
	Descriptor config{};
	const size_t configOffset = decoder.payload + 13u;
	if (!descriptor(input, configOffset, decoder.end, config) || config.tag != 0x05u
		|| config.end != decoder.end
		|| !exactAudioSpecificConfig(input.subspan(config.payload, config.end - config.payload),
			sampleRate, channelCount)) return false;
	Descriptor streamLayer{};
	if (!descriptor(input, decoder.end, es.end, streamLayer) || streamLayer.tag != 0x06u
		|| streamLayer.end != es.end || streamLayer.end - streamLayer.payload != 1u
		|| input[streamLayer.payload] != 0x02u) return false;
	return true;
}

bool exactSampleDescription(
	std::span<const uint8_t> input,
	const Box &box,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	if (box.end - box.payload < 8u || unsigned32(input, box.payload) != 0u
		|| unsigned32(input, box.payload + 4u) != 1u) return false;
	const size_t entry = box.payload + 8u;
	if (box.end - entry < 36u) return false;
	const uint32_t entryBytes = unsigned32(input, entry);
	if (entryBytes < 36u || entryBytes != box.end - entry
		|| unsigned32(input, entry + 4u) != mp4a
		|| unsigned16(input, entry + 14u) != 1u
		|| unsigned16(input, entry + 16u) != 0u
		|| unsigned16(input, entry + 24u) != channelCount
		|| unsigned32(input, entry + 32u) != sampleRate << 16u) return false;
	bool foundEsds = false;
	const bool valid = visitBoxes(input, entry + 36u, entry + entryBytes, [&](const Box &child) {
		if (child.type != esds) return true;
		if (foundEsds || !exactEsds(input, child, sampleRate, channelCount)) return false;
		foundEsds = true;
		return true;
	});
	return valid && foundEsds;
}

bool exactSampleTable(
	std::span<const uint8_t> input,
	const Box &box,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	bool foundStsd = false;
	const bool valid = visitBoxes(input, box.payload, box.end, [&](const Box &child) {
		if (child.type != stsd) return true;
		if (foundStsd || !exactSampleDescription(input, child, sampleRate, channelCount)) return false;
		foundStsd = true;
		return true;
	});
	return valid && foundStsd;
}

bool exactMediaInformation(
	std::span<const uint8_t> input,
	const Box &box,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	bool foundStbl = false;
	const bool valid = visitBoxes(input, box.payload, box.end, [&](const Box &child) {
		if (child.type != stbl) return true;
		if (foundStbl || !exactSampleTable(input, child, sampleRate, channelCount)) return false;
		foundStbl = true;
		return true;
	});
	return valid && foundStbl;
}

TrackInspection inspectTrack(
	std::span<const uint8_t> input,
	const Box &box,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	bool foundMdia = false;
	bool audio = false;
	bool exact = false;
	const bool valid = visitBoxes(input, box.payload, box.end, [&](const Box &child) {
		if (child.type != mdia) return true;
		if (foundMdia) return false;
		foundMdia = true;
		bool foundHandler = false;
		bool foundMinf = false;
		bool mediaExact = false;
		const bool mediaValid = visitBoxes(input, child.payload, child.end, [&](const Box &mediaChild) {
			if (mediaChild.type == hdlr) {
				if (foundHandler || mediaChild.end - mediaChild.payload < 12u
					|| unsigned32(input, mediaChild.payload) != 0u) return false;
				foundHandler = true;
				audio = unsigned32(input, mediaChild.payload + 8u) == soun;
			} else if (mediaChild.type == minf) {
				if (foundMinf) return false;
				foundMinf = true;
				mediaExact = exactMediaInformation(input, mediaChild, sampleRate, channelCount);
			}
			return true;
		});
		if (!mediaValid || !foundHandler || !foundMinf) return false;
		exact = audio && mediaExact;
		return true;
	});
	return TrackInspection{ valid && foundMdia, audio, exact };
}

bool exactFileType(std::span<const uint8_t> input, const Box &box)
{
	if (box.end - box.payload < 8u || (box.end - box.payload - 8u) % 4u != 0u) return false;
	if (unsigned32(input, box.payload) == m4aBrand) return true;
	for (size_t offset = box.payload + 8u; offset < box.end; offset += 4u) {
		if (unsigned32(input, offset) == m4aBrand) return true;
	}
	return false;
}

} // namespace

bool exactAacLcM4a(
	std::span<const uint8_t> input,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	if (input.size() < 16u || input.size() > 32u * 1024u * 1024u
		|| sampleRate < 8000u || sampleRate > 48000u
		|| channelCount < 1u || channelCount > 6u) return false;
	bool foundFileType = false;
	bool foundMovie = false;
	size_t audioTracks = 0u;
	bool exactAudio = false;
	const bool valid = visitBoxes(input, 0u, input.size(), [&](const Box &box) {
		if (box.type == ftyp) {
			if (foundFileType || !exactFileType(input, box)) return false;
			foundFileType = true;
		} else if (box.type == moov) {
			if (foundMovie) return false;
			foundMovie = true;
			const bool movieValid = visitBoxes(input, box.payload, box.end, [&](const Box &child) {
				if (child.type != trak) return true;
				const TrackInspection track = inspectTrack(input, child, sampleRate, channelCount);
				if (!track.valid) return false;
				if (track.audio) {
					audioTracks += 1u;
					exactAudio = track.exact;
				}
				return true;
			});
			if (!movieValid) return false;
		}
		return true;
	});
	return valid && foundFileType && foundMovie && audioTracks == 1u && exactAudio;
}

bool exactAacLcM4aFile(
	const char *path,
	uint64_t expectedBytes,
	uint32_t sampleRate,
	uint32_t channelCount)
{
	if (path == nullptr || expectedBytes == 0u || expectedBytes > 32u * 1024u * 1024u
		|| expectedBytes > std::numeric_limits<size_t>::max()
		|| expectedBytes > static_cast<uint64_t>(std::numeric_limits<std::streamsize>::max())) {
		return false;
	}
	std::ifstream file(path, std::ios::binary);
	std::vector<uint8_t> bytes(static_cast<size_t>(expectedBytes));
	if (!file.read(reinterpret_cast<char *>(bytes.data()),
		static_cast<std::streamsize>(bytes.size()))) return false;
	// A longer file is a different file than the one whose length was authenticated.
	if (file.peek() != std::char_traits<char>::eof()) return false;
	return exactAacLcM4a(bytes, sampleRate, channelCount);
}

} // namespace soundscaper::os_audio
