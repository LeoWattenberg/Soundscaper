/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Bounded whole-file reads for the reviewed Windows codecs, and the byte-level
 * admission they feed.
 *
 * Every path the codecs touch is a private scratch path the caller owns, and
 * both the admitted input and the completed output are proven from their bytes.
 * The reads are wide-path so a profile decision never depends on the process
 * ANSI code page, and they refuse directories, reparse points, and anything
 * longer than the caller's bound rather than reading part of a file.
 */

#ifndef SOUNDSCAPER_PRO_OS_AUDIO_CODEC_WINDOWS_FILE_BYTES_H
#define SOUNDSCAPER_PRO_OS_AUDIO_CODEC_WINDOWS_FILE_BYTES_H

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include "os_aac_m4a_profile.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace soundscaper::os_audio {

inline bool readAllBytes(HANDLE input, BYTE *bytes, size_t length)
{
	size_t offset = 0u;
	while (offset < length) {
		const DWORD requested = static_cast<DWORD>(std::min<size_t>(
			length - offset, std::numeric_limits<DWORD>::max()));
		DWORD readBytes = 0u;
		if (!ReadFile(input, bytes + offset, requested, &readBytes, nullptr) || readBytes == 0u) {
			return false;
		}
		offset += readBytes;
	}
	return true;
}

enum class BoundedFileRead {
	read,
	unreadable,
	overLimit,
};

/** Reads the whole regular file at path when it is at most maximumBytes long. */
inline BoundedFileRead boundedFileBytes(
	const std::wstring &path,
	uint64_t maximumBytes,
	std::vector<uint8_t> &bytes)
{
	WIN32_FILE_ATTRIBUTE_DATA metadata{};
	if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &metadata)
		|| (metadata.dwFileAttributes
			& (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0u) {
		return BoundedFileRead::unreadable;
	}
	ULARGE_INTEGER size{};
	size.HighPart = metadata.nFileSizeHigh;
	size.LowPart = metadata.nFileSizeLow;
	if (size.QuadPart == 0u) return BoundedFileRead::unreadable;
	if (size.QuadPart > maximumBytes) return BoundedFileRead::overLimit;
	if (size.QuadPart > std::numeric_limits<DWORD>::max()) return BoundedFileRead::unreadable;
	HANDLE input = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
	if (input == INVALID_HANDLE_VALUE) return BoundedFileRead::unreadable;
	bytes.assign(static_cast<size_t>(size.QuadPart), 0u);
	const bool read = readAllBytes(input, bytes.data(), bytes.size());
	const bool closed = CloseHandle(input) != 0;
	return read && closed ? BoundedFileRead::read : BoundedFileRead::unreadable;
}

enum class EncodedOutputInspection {
	exact,
	invalid,
	/* The completed file was read whole and is not the exact admitted tuple.
	 * That is a verdict about the encoder's output, not a failure to encode. */
	notExact,
	overLimit,
};

inline EncodedOutputInspection inspectEncodedOutput(
	const std::wstring &path,
	uint64_t maximumBytes,
	uint64_t &outputBytes,
	AacLcM4aRefusal &refusal)
{
	std::vector<uint8_t> bytes;
	const BoundedFileRead outcome = boundedFileBytes(path, maximumBytes, bytes);
	if (outcome == BoundedFileRead::overLimit) return EncodedOutputInspection::overLimit;
	if (outcome != BoundedFileRead::read) return EncodedOutputInspection::invalid;
	if (!exactAacLcM4a(bytes, 48000u, 2u, refusal)) {
		return EncodedOutputInspection::notExact;
	}
	outputBytes = bytes.size();
	return EncodedOutputInspection::exact;
}

/**
 * Proves the admitted M4A input is exact AAC-LC from its own bytes. The length
 * was already authenticated, so a file that is no longer exactly that long is
 * refused by the bound rather than read in part.
 */
inline bool exactAacLcInput(
	const std::wstring &path,
	uint64_t expectedBytes,
	uint32_t sampleRate,
	uint32_t channelCount,
	AacLcM4aRefusal &refusal)
{
	std::vector<uint8_t> bytes;
	refusal = AacLcM4aRefusal::bounds;
	if (expectedBytes == 0u || expectedBytes > 32u * 1024u * 1024u
		|| boundedFileBytes(path, expectedBytes, bytes) != BoundedFileRead::read
		|| bytes.size() != expectedBytes) return false;
	return exactAacLcM4a(bytes, sampleRate, channelCount, refusal);
}

} // namespace soundscaper::os_audio

#endif
