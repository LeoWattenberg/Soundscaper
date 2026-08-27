/* SPDX-License-Identifier: AGPL-3.0-only */

/** Platform-neutral, bounded admission of the exact reviewed AAC-LC M4A tuple. */

#ifndef SOUNDSCAPER_PRO_OS_AAC_M4A_PROFILE_H
#define SOUNDSCAPER_PRO_OS_AAC_M4A_PROFILE_H

#include <cstdint>
#include <span>

namespace soundscaper::os_audio {

bool exactAacLcM4a(
	std::span<const uint8_t> input,
	uint32_t sampleRate,
	uint32_t channelCount);

/**
 * Reads exactly expectedBytes from path and admits them under the same rule.
 * Both reviewed targets prove an M4A input this way, so the admitted tuple is
 * decided by the bytes rather than by whatever optional descriptors the host
 * media framework chose to surface for the file.
 */
bool exactAacLcM4aFile(
	const char *path,
	uint64_t expectedBytes,
	uint32_t sampleRate,
	uint32_t channelCount);

} // namespace soundscaper::os_audio

#endif
