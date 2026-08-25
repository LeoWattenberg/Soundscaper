/* SPDX-License-Identifier: AGPL-3.0-only */

#include <limits.h>
#include <stdint.h>
#include <stdlib.h>

#include <twolame.h>

#define SCTL_ABI_VERSION 1
#define SCTL_MAXIMUM_CHANNELS 2
#define SCTL_MAXIMUM_FRAMES 8388608
#define SCTL_INITIAL_MEMORY_BYTES 8388608
#define SCTL_MAXIMUM_MEMORY_BYTES 268435456
#define SCTL_SAMPLES_PER_FRAME 1152

int sctl_abi_version(void) { return SCTL_ABI_VERSION; }
int sctl_twolame_major(void) { return 0; }
int sctl_twolame_minor(void) { return 4; }
int sctl_twolame_patch(void) { return 0; }
int sctl_maximum_channels(void) { return SCTL_MAXIMUM_CHANNELS; }
int sctl_maximum_frames(void) { return SCTL_MAXIMUM_FRAMES; }
int sctl_initial_memory_bytes(void) { return SCTL_INITIAL_MEMORY_BYTES; }
int sctl_maximum_memory_bytes(void) { return SCTL_MAXIMUM_MEMORY_BYTES; }

void *sctl_allocate(size_t bytes) {
	return bytes > 0 && bytes <= SCTL_MAXIMUM_MEMORY_BYTES ? malloc(bytes) : NULL;
}

void sctl_free(void *pointer) { free(pointer); }

static int admitted_sample_rate(uint32_t sample_rate) {
	return sample_rate == 32000 || sample_rate == 44100 || sample_rate == 48000;
}

static int admitted_bitrate(uint32_t bitrate) {
	switch (bitrate) {
	case 32: case 48: case 56: case 64: case 80: case 96: case 112:
	case 128: case 160: case 192: case 224: case 256: case 320: case 384:
		return 1;
	default:
		return 0;
	}
}

static int admitted_combination(uint32_t channels, uint32_t bitrate) {
	return channels == 1 ? bitrate <= 192
		: channels == 2 ? bitrate >= 64 && bitrate != 80
		: 0;
}

static int required_output_bytes(
	uint32_t frames,
	uint32_t sample_rate,
	uint32_t bitrate,
	uint32_t *result
) {
	uint64_t mpeg_frames = ((uint64_t)frames + SCTL_SAMPLES_PER_FRAME - 1)
		/ SCTL_SAMPLES_PER_FRAME;
	uint64_t numerator = 144 * (uint64_t)bitrate * 1000;
	uint64_t maximum_frame_bytes = numerator / sample_rate + (numerator % sample_rate == 0 ? 0 : 1);
	uint64_t required = mpeg_frames * maximum_frame_bytes;
	if (required == 0 || required > UINT32_MAX) return 0;
	*result = (uint32_t)required;
	return 1;
}

static int configure_encoder(
	twolame_options *options,
	uint32_t channels,
	uint32_t sample_rate,
	uint32_t bitrate
) {
	return twolame_set_verbosity(options, 0) == 0
		&& twolame_set_version(options, TWOLAME_MPEG1) == 0
		&& twolame_set_num_channels(options, (int)channels) == 0
		&& twolame_set_in_samplerate(options, (int)sample_rate) == 0
		&& twolame_set_out_samplerate(options, (int)sample_rate) == 0
		&& twolame_set_bitrate(options, (int)bitrate) == 0
		&& twolame_set_mode(options, channels == 1 ? TWOLAME_MONO : TWOLAME_STEREO) == 0
		&& twolame_set_padding(options, TWOLAME_PAD_ALL) == 0
		&& twolame_set_VBR(options, FALSE) == 0
		&& twolame_set_freeformat(options, FALSE) == 0
		&& twolame_set_psymodel(options, 3) == 0
		&& twolame_set_energy_levels(options, FALSE) == 0
		&& twolame_set_emphasis(options, TWOLAME_EMPHASIS_N) == 0
		&& twolame_set_error_protection(options, FALSE) == 0
		&& twolame_set_copyright(options, FALSE) == 0
		&& twolame_set_original(options, TRUE) == 0
		&& twolame_set_DAB(options, FALSE) == 0
		&& twolame_init_params(options) == 0;
}

int sctl_encode_float32(
	const float *input,
	uint32_t frames,
	uint32_t channels,
	uint32_t sample_rate,
	uint32_t bitrate,
	unsigned char *output,
	uint32_t output_capacity
) {
	if (!input || !output || frames == 0 || frames > SCTL_MAXIMUM_FRAMES
		|| !admitted_sample_rate(sample_rate) || !admitted_bitrate(bitrate)
		|| !admitted_combination(channels, bitrate) || output_capacity == 0
		|| frames > INT_MAX || output_capacity > INT_MAX) return 0;
	uint32_t required;
	if (!required_output_bytes(frames, sample_rate, bitrate, &required)) return 0;
	if (output_capacity < required) return -1;
	twolame_options *options = twolame_init();
	if (!options) return 0;
	int result = 0;
	if (!configure_encoder(options, channels, sample_rate, bitrate)) goto cleanup;
	int encoded = twolame_encode_buffer_float32_interleaved(
		options, input, (int)frames, output, (int)output_capacity
	);
	if (encoded < 0 || encoded > (int)output_capacity) goto cleanup;
	int flushed = twolame_encode_flush(
		options, output + encoded, (int)output_capacity - encoded
	);
	if (flushed < 0 || flushed > (int)output_capacity - encoded) goto cleanup;
	if (encoded + flushed > 0) result = encoded + flushed;
cleanup:
	twolame_close(&options);
	return result;
}
