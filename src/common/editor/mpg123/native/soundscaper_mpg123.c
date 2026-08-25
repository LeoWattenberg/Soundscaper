/* SPDX-License-Identifier: AGPL-3.0-only */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <mpg123.h>

#define SCMP_ABI_VERSION 1
#define SCMP_MAXIMUM_FRAMES 33554432U
#define SCMP_INITIAL_MEMORY_BYTES 8388608U
#define SCMP_MAXIMUM_MEMORY_BYTES 268435456U
#define SCMP_MAXIMUM_INPUT_BYTES 33554432U
#define SCMP_MAXIMUM_OUTPUT_BYTES 134217728U

int scmp_abi_version(void) { return SCMP_ABI_VERSION; }
int scmp_maximum_frames(void) { return (int)SCMP_MAXIMUM_FRAMES; }
int scmp_initial_memory_bytes(void) { return (int)SCMP_INITIAL_MEMORY_BYTES; }
int scmp_maximum_memory_bytes(void) { return (int)SCMP_MAXIMUM_MEMORY_BYTES; }

void *scmp_allocate(size_t bytes) {
	if (bytes == 0 || bytes > SCMP_MAXIMUM_MEMORY_BYTES) return NULL;
	return malloc(bytes);
}

void scmp_free(void *pointer) { free(pointer); }

int scmp_decode_float32(
	const unsigned char *input,
	uint32_t input_bytes,
	uint32_t expected_frames,
	uint32_t expected_rate,
	uint32_t expected_channels,
	float *output,
	uint32_t output_bytes
) {
	uint64_t required = (uint64_t)expected_frames * expected_channels * sizeof(float);
	if (!input || !output || input_bytes < 4 || input_bytes > SCMP_MAXIMUM_INPUT_BYTES
		|| expected_frames == 0 || expected_frames > SCMP_MAXIMUM_FRAMES
		|| (expected_rate != 32000 && expected_rate != 44100 && expected_rate != 48000)
		|| (expected_channels != 1 && expected_channels != 2)
		|| required == 0 || required > SCMP_MAXIMUM_OUTPUT_BYTES || required != output_bytes) return 0;
	int initialized = 0;
	int error = MPG123_OK;
	mpg123_handle *decoder = NULL;
	uint32_t written = 0;
	if (mpg123_init() != MPG123_OK) goto cleanup;
	initialized = 1;
	decoder = mpg123_new("generic", &error);
	if (!decoder || error != MPG123_OK
		|| mpg123_param(decoder, MPG123_FLAGS,
			MPG123_GAPLESS | MPG123_QUIET | MPG123_NO_RESYNC | MPG123_FORCE_FLOAT, 0.0) != MPG123_OK
		|| mpg123_param(decoder, MPG123_RESYNC_LIMIT, 0, 0.0) != MPG123_OK
		|| mpg123_param(decoder, MPG123_FEEDPOOL, 1, 0.0) != MPG123_OK
		|| mpg123_format_none(decoder) != MPG123_OK
		|| mpg123_format(decoder, (long)expected_rate,
			expected_channels == 1 ? MPG123_MONO : MPG123_STEREO,
			MPG123_ENC_FLOAT_32) != MPG123_OK
		|| mpg123_open_feed(decoder) != MPG123_OK
		|| mpg123_feed(decoder, input, input_bytes) != MPG123_OK) goto cleanup;
	uint32_t calls = 0;
	uint32_t maximum_calls = expected_frames / 576U + 64U;
	for (;;) {
		int64_t frame_number = 0;
		unsigned char *audio = NULL;
		size_t bytes = 0;
		if (++calls > maximum_calls) goto cleanup;
		int status = mpg123_decode_frame64(decoder, &frame_number, &audio, &bytes);
		if (status == MPG123_NEW_FORMAT) {
			long rate = 0;
			int channels = 0;
			int encoding = 0;
			if (mpg123_getformat(decoder, &rate, &channels, &encoding) != MPG123_OK
				|| rate != (long)expected_rate || channels != (int)expected_channels
				|| encoding != MPG123_ENC_FLOAT_32) goto cleanup;
			continue;
		}
		if (status == MPG123_NEED_MORE) break;
		if (status != MPG123_OK || bytes % (expected_channels * sizeof(float)) != 0
			|| bytes > output_bytes - written || (bytes > 0 && !audio)) goto cleanup;
		if (bytes > 0) {
			memcpy((unsigned char *)output + written, audio, bytes);
			written += (uint32_t)bytes;
		}
	}
	if (written != output_bytes) goto cleanup;
	for (uint64_t index = 0; index < required / sizeof(float); ++index) {
		if (!isfinite(output[index])) goto cleanup;
	}
	error = (int)expected_frames;
cleanup:
	if (decoder) {
		mpg123_close(decoder);
		mpg123_delete(decoder);
	}
	if (initialized) mpg123_exit();
	return error == (int)expected_frames ? error : 0;
}
