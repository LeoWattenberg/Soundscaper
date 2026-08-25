/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_PRO_OS_MP3_PROFILE_H
#define SOUNDSCAPER_PRO_OS_MP3_PROFILE_H

#include <cstdint>
#include <vector>

namespace soundscaper::os_audio {

/** Validates one complete constant-bitrate MPEG-1 Layer III file, allowing only ID3 wrappers. */
bool exactMp3(
	const std::vector<uint8_t> &bytes,
	uint32_t expectedSampleRate,
	uint32_t expectedChannelCount,
	uint32_t expectedBitrateKbps);

} // namespace soundscaper::os_audio

#endif
