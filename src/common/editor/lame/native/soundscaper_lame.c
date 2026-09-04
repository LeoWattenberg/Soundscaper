/* SPDX-License-Identifier: AGPL-3.0-only */

#include <limits.h>
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "lame.h"

#define SCLM_ABI_VERSION 2
#define SCLM_MAXIMUM_CHANNELS 2
#define SCLM_MAXIMUM_FRAMES 8388608
#define SCLM_INITIAL_MEMORY_BYTES (8 * 1024 * 1024)
#define SCLM_MAXIMUM_MEMORY_BYTES (256 * 1024 * 1024)
#define SCLM_FLUSH_BYTES 7200
#define SCLM_LAME_QUALITY 2

/*
 * Reviewed bit-rate strategies, ported from Audacity's MP3 exporter. Each mode
 * reads `rate_value` differently: constant and average take a bitrate in kbps,
 * variable takes a VBR quality of 0 (best) through 9, and preset takes one of
 * the four named presets below.
 */
#define SCLM_RATE_MODE_CONSTANT 0
#define SCLM_RATE_MODE_AVERAGE 1
#define SCLM_RATE_MODE_VARIABLE 2
#define SCLM_RATE_MODE_PRESET 3
#define SCLM_MAXIMUM_RATE_MODE 3
#define SCLM_MAXIMUM_VBR_QUALITY 9
#define SCLM_MAXIMUM_PRESET 3
#define SCLM_MINIMUM_BITRATE 8
#define SCLM_MAXIMUM_BITRATE 320

static void sclm_silent_report(const char *format, va_list arguments) {
	(void) format;
	(void) arguments;
}

int sclm_abi_version(void) { return SCLM_ABI_VERSION; }
int sclm_lame_major(void) {
	lame_version_t version;
	memset(&version, 0, sizeof(version));
	get_lame_version_numerical(&version);
	return version.major;
}
int sclm_lame_minor(void) {
	lame_version_t version;
	memset(&version, 0, sizeof(version));
	get_lame_version_numerical(&version);
	return version.minor;
}
int sclm_maximum_channels(void) { return SCLM_MAXIMUM_CHANNELS; }
int sclm_maximum_frames(void) { return SCLM_MAXIMUM_FRAMES; }
int sclm_maximum_rate_mode(void) { return SCLM_MAXIMUM_RATE_MODE; }
int sclm_maximum_vbr_quality(void) { return SCLM_MAXIMUM_VBR_QUALITY; }
int sclm_maximum_preset(void) { return SCLM_MAXIMUM_PRESET; }
int sclm_initial_memory_bytes(void) { return SCLM_INITIAL_MEMORY_BYTES; }
int sclm_maximum_memory_bytes(void) { return SCLM_MAXIMUM_MEMORY_BYTES; }

void *sclm_allocate(size_t bytes) {
	if (bytes == 0 || bytes > SCLM_MAXIMUM_MEMORY_BYTES) return NULL;
	return malloc(bytes);
}

void sclm_free(void *pointer) { free(pointer); }

/*
 * Audacity's preset row expands through LAME's own preset table: Excessive is
 * constant 320 kbps, and Extreme, Standard, and Medium are variable V0, V2, and
 * V4. Average uses LAME's ABR preset, exactly as Audacity's MODE_ABR does.
 */
static const int SCLM_PRESET_IDENTIFIERS[SCLM_MAXIMUM_PRESET + 1] = {
	INSANE, EXTREME_FAST, STANDARD_FAST, MEDIUM_FAST
};
static const int SCLM_PRESET_VBR_QUALITY[SCLM_MAXIMUM_PRESET + 1] = { -1, 0, 2, 4 };

static int sclm_configure_rate(lame_t encoder, int rate_mode, int rate_value) {
	if (rate_mode == SCLM_RATE_MODE_CONSTANT) {
		if (lame_set_VBR(encoder, vbr_off) != 0) return -108;
		if (lame_set_brate(encoder, rate_value) != 0) return -109;
		/* Only the constant path pins algorithm quality; presets carry their own. */
		if (lame_set_quality(encoder, SCLM_LAME_QUALITY) != 0) return -110;
		return 0;
	}
	if (rate_mode == SCLM_RATE_MODE_AVERAGE) {
		return lame_set_preset(encoder, rate_value) == rate_value ? 0 : -118;
	}
	if (rate_mode == SCLM_RATE_MODE_VARIABLE) {
		if (lame_set_VBR(encoder, vbr_mtrh) != 0) return -108;
		if (lame_set_VBR_q(encoder, rate_value) != 0) return -119;
		return 0;
	}
	lame_set_preset(encoder, SCLM_PRESET_IDENTIFIERS[rate_value]);
	return 0;
}

static int sclm_verify_rate(lame_t encoder, int rate_mode, int rate_value) {
	if (rate_mode == SCLM_RATE_MODE_CONSTANT) {
		return lame_get_VBR(encoder) == vbr_off && lame_get_brate(encoder) == rate_value
			&& lame_get_quality(encoder) == SCLM_LAME_QUALITY;
	}
	if (rate_mode == SCLM_RATE_MODE_AVERAGE) {
		return lame_get_VBR(encoder) == vbr_abr
			&& lame_get_VBR_mean_bitrate_kbps(encoder) == rate_value;
	}
	if (rate_mode == SCLM_RATE_MODE_VARIABLE) {
		return lame_get_VBR(encoder) == vbr_mtrh && lame_get_VBR_q(encoder) == rate_value;
	}
	if (rate_value == 0) {
		return lame_get_VBR(encoder) == vbr_off && lame_get_brate(encoder) == 320;
	}
	return lame_get_VBR(encoder) == vbr_mtrh
		&& lame_get_VBR_q(encoder) == SCLM_PRESET_VBR_QUALITY[rate_value];
}

static int sclm_configure(
	lame_t encoder, int frames, int channels, int sample_rate, int rate_mode, int rate_value
) {
	if (lame_set_errorf(encoder, sclm_silent_report) != 0) return -101;
	if (lame_set_debugf(encoder, sclm_silent_report) != 0) return -102;
	if (lame_set_msgf(encoder, sclm_silent_report) != 0) return -103;
	if (lame_set_num_samples(encoder, (unsigned long) frames) != 0) return -104;
	if (lame_set_num_channels(encoder, channels) != 0) return -105;
	if (lame_set_in_samplerate(encoder, sample_rate) != 0) return -106;
	if (lame_set_out_samplerate(encoder, sample_rate) != 0) return -107;
	int rate = sclm_configure_rate(encoder, rate_mode, rate_value);
	if (rate != 0) return rate;
	if (lame_set_mode(encoder, channels == 1 ? MONO : JOINT_STEREO) != 0) return -111;
	if (lame_set_strict_ISO(encoder, MDB_STRICT_ISO) != 0) return -112;
	if (lame_set_findReplayGain(encoder, 0) != 0) return -113;
	if (lame_set_bWriteVbrTag(encoder, 1) != 0) return -115;
	lame_set_write_id3tag_automatic(encoder, 0);
	if (lame_init_params(encoder) != 0) return -116;
	if (lame_get_num_channels(encoder) != channels
		|| lame_get_in_samplerate(encoder) != sample_rate
		|| lame_get_out_samplerate(encoder) != sample_rate
		|| !sclm_verify_rate(encoder, rate_mode, rate_value)) return -117;
	return 0;
}

static int sclm_rate_arguments_admitted(int rate_mode, int rate_value) {
	if (rate_mode == SCLM_RATE_MODE_VARIABLE) {
		return rate_value >= 0 && rate_value <= SCLM_MAXIMUM_VBR_QUALITY;
	}
	if (rate_mode == SCLM_RATE_MODE_PRESET) {
		return rate_value >= 0 && rate_value <= SCLM_MAXIMUM_PRESET;
	}
	if (rate_mode != SCLM_RATE_MODE_CONSTANT && rate_mode != SCLM_RATE_MODE_AVERAGE) return 0;
	return rate_value >= SCLM_MINIMUM_BITRATE && rate_value <= SCLM_MAXIMUM_BITRATE;
}

int sclm_encode_float32(
	const float *input,
	int frames,
	int channels,
	int sample_rate,
	int rate_mode,
	int rate_value,
	unsigned char *output,
	int output_capacity
) {
	if (input == NULL || output == NULL || frames < 1 || frames > SCLM_MAXIMUM_FRAMES
		|| (channels != 1 && channels != 2) || sample_rate < 8000 || sample_rate > 48000
		|| !sclm_rate_arguments_admitted(rate_mode, rate_value)
		|| output_capacity < SCLM_FLUSH_BYTES || output_capacity > INT_MAX) return -2;
	for (size_t index = 0; index < (size_t) frames * (size_t) channels; index++) {
		if (!isfinite(input[index])) return -2;
	}
	lame_t encoder = lame_init();
	if (encoder == NULL) return -3;
	int result = -3;
	int configured = sclm_configure(
		encoder, frames, channels, sample_rate, rate_mode, rate_value
	);
	if (configured != 0) {
		result = configured;
		goto finish;
	}
	int written = channels == 2
		? lame_encode_buffer_interleaved_ieee_float(
			encoder, input, frames, output, output_capacity
		)
		: lame_encode_buffer_ieee_float(
			encoder, input, input, frames, output, output_capacity
		);
	if (written < 0) {
		result = written == -1 ? -1 : -3;
		goto finish;
	}
	if (output_capacity - written < SCLM_FLUSH_BYTES) {
		result = -1;
		goto finish;
	}
	int flushed = lame_encode_flush(
		encoder, output + written, output_capacity - written
	);
	if (flushed < 0) {
		result = flushed == -1 ? -1 : -3;
		goto finish;
	}
	if (written > INT_MAX - flushed) goto finish;
	int total = written + flushed;
	size_t tag_bytes = lame_get_lametag_frame(encoder, output, (size_t) output_capacity);
	if (tag_bytes == 0 || tag_bytes > (size_t) total || tag_bytes > (size_t) output_capacity) {
		goto finish;
	}
	result = total;

finish:
	if (lame_close(encoder) != 0 && result >= 0) return -3;
	return result;
}
