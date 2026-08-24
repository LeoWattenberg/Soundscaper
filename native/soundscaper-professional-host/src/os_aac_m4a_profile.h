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

} // namespace soundscaper::os_audio

#endif
