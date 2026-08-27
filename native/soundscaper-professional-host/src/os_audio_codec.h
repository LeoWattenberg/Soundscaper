/* SPDX-License-Identifier: AGPL-3.0-only */

/** Narrow operating-system audio-codec ABI used only by the trusted utility addon. */

#ifndef SOUNDSCAPER_PRO_OS_AUDIO_CODEC_H
#define SOUNDSCAPER_PRO_OS_AUDIO_CODEC_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum soundscaper_pro_os_codec_status {
	SOUNDSCAPER_PRO_OS_CODEC_OK = 0,
	SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE = 1,
	SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED = 2,
	SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST = 3,
	SOUNDSCAPER_PRO_OS_CODEC_INPUT_CHANGED = 4,
	SOUNDSCAPER_PRO_OS_CODEC_OUTPUT_LIMIT = 5,
	SOUNDSCAPER_PRO_OS_CODEC_IO_FAILED = 6,
	SOUNDSCAPER_PRO_OS_CODEC_DECODE_FAILED = 7,
	SOUNDSCAPER_PRO_OS_CODEC_ENCODE_FAILED = 8
} soundscaper_pro_os_codec_status;

typedef struct soundscaper_pro_os_mp3_decode_request {
	const char *input_path_utf8;
	const char *output_path_utf8;
	uint64_t input_bytes;
	uint64_t maximum_output_bytes;
} soundscaper_pro_os_mp3_decode_request;

typedef struct soundscaper_pro_os_mp3_decode_result {
	soundscaper_pro_os_codec_status status;
	uint32_t native_api_reached;
	uint32_t exact_tuple_passed;
	uint64_t output_bytes;
	uint64_t frame_count;
	uint32_t sample_rate;
	uint32_t channel_count;
	/* Zero unless a refusal names the admission layer it came from. Only the
	 * target canary reads it: an unattended run otherwise reports that a tuple
	 * was refused without reporting which rule refused it. */
	uint32_t refusal_detail;
} soundscaper_pro_os_mp3_decode_result;

typedef struct soundscaper_pro_os_aac_m4a_encode_request {
	const char *input_path_utf8;
	const char *output_path_utf8;
	uint64_t input_bytes;
	uint64_t maximum_output_bytes;
	uint32_t sample_rate;
	uint32_t channel_count;
	uint32_t bitrate_kbps;
} soundscaper_pro_os_aac_m4a_encode_request;

typedef struct soundscaper_pro_os_aac_m4a_encode_result {
	soundscaper_pro_os_codec_status status;
	uint32_t native_api_reached;
	uint32_t exact_tuple_passed;
	uint64_t output_bytes;
	uint64_t frame_count;
	uint32_t sample_rate;
	uint32_t channel_count;
	uint32_t bitrate_kbps;
	/* Zero unless a refusal names the admission layer it came from. Only the
	 * target canary reads it: an unattended run otherwise reports that a tuple
	 * was refused without reporting which rule refused it. */
	uint32_t refusal_detail;
} soundscaper_pro_os_aac_m4a_encode_result;

typedef struct soundscaper_pro_os_mp3_encode_request {
	const char *input_path_utf8;
	const char *output_path_utf8;
	uint64_t input_bytes;
	uint64_t maximum_output_bytes;
	uint32_t sample_rate;
	uint32_t channel_count;
	uint32_t bitrate_kbps;
} soundscaper_pro_os_mp3_encode_request;

typedef struct soundscaper_pro_os_mp3_encode_result {
	soundscaper_pro_os_codec_status status;
	uint32_t native_api_reached;
	uint32_t exact_tuple_passed;
	uint64_t output_bytes;
	uint64_t frame_count;
	uint32_t sample_rate;
	uint32_t channel_count;
	uint32_t bitrate_kbps;
} soundscaper_pro_os_mp3_encode_result;

/**
 * Decodes one authenticated MP3 file to tightly interleaved native-endian
 * float32 PCM. The caller owns both private scratch paths and removes every
 * partial output after a non-OK result.
 */
soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_mp3_decode(
	const soundscaper_pro_os_mp3_decode_request *request);

/**
 * Decodes one authenticated AAC-LC-in-M4A file through the target OS codec.
 * The bounded file and authoritative float32 geometry contract is identical
 * to MP3 decode; raw ADTS AAC and non-LC object types are refused.
 */
soundscaper_pro_os_mp3_decode_result soundscaper_pro_os_aac_m4a_decode(
	const soundscaper_pro_os_mp3_decode_request *request);

/**
 * Encodes exact 48 kHz stereo interleaved little-endian float32 PCM to one
 * 160 kbps AAC-LC M4A file. The implementation verifies the completed output
 * container and AudioSpecificConfig before returning success.
 */
soundscaper_pro_os_aac_m4a_encode_result soundscaper_pro_os_aac_m4a_encode(
	const soundscaper_pro_os_aac_m4a_encode_request *request);

/**
 * Encodes exact 48 kHz stereo interleaved little-endian float32 PCM to one
 * 192 kbps MPEG-1 Layer III file on reviewed Windows targets. The completed
 * raw frame chain is structurally re-opened and verified before success.
 */
soundscaper_pro_os_mp3_encode_result soundscaper_pro_os_mp3_encode(
	const soundscaper_pro_os_mp3_encode_request *request);

#ifdef __cplusplus
}
#endif

#endif
