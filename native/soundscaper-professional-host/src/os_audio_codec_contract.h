/* SPDX-License-Identifier: AGPL-3.0-only */

/** Platform-neutral request geometry and ABI result initialization for reviewed OS codecs. */

#ifndef SOUNDSCAPER_PRO_OS_AUDIO_CODEC_CONTRACT_H
#define SOUNDSCAPER_PRO_OS_AUDIO_CODEC_CONTRACT_H

#include "os_audio_codec.h"

#include <cstdint>
#include <cstring>

namespace soundscaper::os_audio {

inline bool exactScratchRequest(
	const char *inputPath,
	const char *outputPath,
	uint64_t inputBytes,
	uint64_t maximumOutputBytes)
{
	return inputPath != nullptr && outputPath != nullptr && inputBytes > 0u
		&& maximumOutputBytes > 0u && std::strlen(inputPath) > 0u
		&& std::strlen(inputPath) <= 4096u && std::strlen(outputPath) > 0u
		&& std::strlen(outputPath) <= 4096u && std::strcmp(inputPath, outputPath) != 0;
}

inline bool exactFloat32StereoEncodeRequest(
	const char *inputPath,
	const char *outputPath,
	uint64_t inputBytes,
	uint64_t maximumOutputBytes,
	uint32_t sampleRate,
	uint32_t channelCount,
	uint32_t bitrateKbps,
	uint32_t expectedBitrateKbps)
{
	return exactScratchRequest(inputPath, outputPath, inputBytes, maximumOutputBytes)
		&& inputBytes <= 32u * 1024u * 1024u
		&& maximumOutputBytes <= 128u * 1024u * 1024u
		&& inputBytes % (2u * sizeof(float)) == 0u
		&& sampleRate == 48000u && channelCount == 2u
		&& bitrateKbps == expectedBitrateKbps;
}

template<typename Result>
Result codecAnswer(soundscaper_pro_os_codec_status status, bool nativeApiReached = false)
{
	Result result{};
	result.status = status;
	result.native_api_reached = nativeApiReached ? 1u : 0u;
	return result;
}

inline const char *codecStatusName(
	soundscaper_pro_os_codec_status status,
	const char *success,
	const char *failure)
{
	switch (status) {
	case SOUNDSCAPER_PRO_OS_CODEC_OK: return success;
	case SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE: return "api-unavailable";
	case SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED: return "tuple-unsupported";
	case SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST: return "invalid-request";
	case SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED: return "input-changed";
	case SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT: return "output-limit";
	case SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED: return "io-failed";
	default: return failure;
	}
}

} // namespace soundscaper::os_audio

#endif
