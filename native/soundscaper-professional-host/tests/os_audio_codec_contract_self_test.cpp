/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec_contract.h"

#include <cstdint>
#include <cstring>

int main()
{
	using soundscaper::os_audio::codecAnswer;
	using soundscaper::os_audio::codecStatusName;
	using soundscaper::os_audio::exactFloat32StereoEncodeRequest;
	using soundscaper::os_audio::exactScratchRequest;
	if (!exactScratchRequest("input.pcm", "output.m4a", 8u, 1024u)) return 1;
	if (exactScratchRequest(nullptr, "out", 8u, 1024u)
		|| exactScratchRequest("same", "same", 8u, 1024u)
		|| exactScratchRequest("in", "out", 0u, 1024u)) return 2;
	if (!exactFloat32StereoEncodeRequest("in", "out", 8u, 1024u,
		48000u, 2u, 160u, 160u)
		|| !exactFloat32StereoEncodeRequest("in", "out", 8u, 1024u,
			48000u, 2u, 192u, 192u)) return 3;
	if (exactFloat32StereoEncodeRequest("in", "out", 8u, 1024u,
		48000u, 2u, 160u, 192u)
		|| exactFloat32StereoEncodeRequest("in", "out", 7u, 1024u,
			48000u, 2u, 160u, 160u)
		|| exactFloat32StereoEncodeRequest("in", "out", 8u, 1024u,
			44100u, 2u, 160u, 160u)) return 4;
	const auto decoded = codecAnswer<soundscaper_pro_os_mp3_decode_result>(
		SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, true);
	const auto encoded = codecAnswer<soundscaper_pro_os_aac_m4a_encode_result>(
		SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT, false);
	const auto mp3 = codecAnswer<soundscaper_pro_os_mp3_encode_result>(
		SOUNDSCAPER_PRO_OS_CODEC_OK, true);
	if (decoded.status != SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED
		|| decoded.native_api_reached != 1u || decoded.exact_tuple_passed != 0u
		|| decoded.output_bytes != 0u || decoded.refusal_detail != 0u
		|| encoded.status != SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT
		|| encoded.native_api_reached != 0u || encoded.output_bytes != 0u
		|| mp3.status != SOUNDSCAPER_PRO_OS_CODEC_OK
		|| mp3.native_api_reached != 1u || mp3.frame_count != 0u) return 5;
	const char *success = "decoded";
	const char *failure = "decode-failed";
	if (codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_OK, success, failure) != success
		|| std::strcmp(codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE, success, failure), "api-unavailable") != 0
		|| std::strcmp(codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED, success, failure), "tuple-unsupported") != 0
		|| std::strcmp(codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST, success, failure), "invalid-request") != 0
		|| std::strcmp(codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED, success, failure), "input-changed") != 0
		|| std::strcmp(codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT, success, failure), "output-limit") != 0
		|| std::strcmp(codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED, success, failure), "io-failed") != 0
		|| codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED, success, failure) != failure
		|| codecStatusName(SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED, success, failure) != failure) return 6;
	return 0;
}
