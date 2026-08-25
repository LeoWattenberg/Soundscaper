/* SPDX-License-Identifier: AGPL-3.0-only */

#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <ogg/ogg.h>
#include <vorbis/vorbisenc.h>
#include <vorbis/vorbisfile.h>

#define SCVB_ABI_VERSION 1
#define SCVB_MINIMUM_SAMPLE_RATE 8000
#define SCVB_MAXIMUM_SAMPLE_RATE 192000
#define SCVB_MAXIMUM_CHANNELS 2
#define SCVB_MAXIMUM_FRAMES 33554432
#define SCVB_INITIAL_MEMORY_BYTES 8388608
#define SCVB_MAXIMUM_MEMORY_BYTES 268435456
#define SCVB_SERIAL 0x53435642

typedef struct {
	unsigned char *bytes;
	size_t capacity;
	size_t length;
	int failed;
} Output;

typedef struct {
	const unsigned char *bytes;
	size_t length;
	size_t offset;
} Input;

static void append_page(Output *output, const ogg_page *page) {
	size_t header = (size_t)page->header_len;
	size_t body = (size_t)page->body_len;
	if (output->failed || header > output->capacity - output->length
		|| body > output->capacity - output->length - header) {
		output->failed = 1;
		return;
	}
	memcpy(output->bytes + output->length, page->header, header);
	output->length += header;
	memcpy(output->bytes + output->length, page->body, body);
	output->length += body;
}

static int drain_pages(ogg_stream_state *stream, Output *output, int force) {
	ogg_page page;
	int emitted;
	do {
		emitted = force ? ogg_stream_flush(stream, &page) : ogg_stream_pageout(stream, &page);
		if (emitted > 0) append_page(output, &page);
	} while (emitted > 0 && !output->failed);
	return !output->failed;
}

static int drain_packets(
	vorbis_dsp_state *dsp,
	vorbis_block *block,
	ogg_stream_state *stream,
	Output *output
) {
	ogg_packet packet;
	while (vorbis_analysis_blockout(dsp, block) == 1) {
		if (vorbis_analysis(block, NULL) != 0 || vorbis_bitrate_addblock(block) != 0) return 0;
		while (vorbis_bitrate_flushpacket(dsp, &packet) == 1) {
			if (ogg_stream_packetin(stream, &packet) != 0
				|| !drain_pages(stream, output, packet.e_o_s)) return 0;
		}
	}
	return 1;
}

static size_t memory_read(void *pointer, size_t size, size_t count, void *data_source) {
	Input *input = (Input *)data_source;
	if (size == 0 || count == 0 || input->offset >= input->length) return 0;
	size_t available_items = (input->length - input->offset) / size;
	if (count > available_items) count = available_items;
	size_t bytes = size * count;
	memcpy(pointer, input->bytes + input->offset, bytes);
	input->offset += bytes;
	return count;
}

static int memory_seek(void *data_source, ogg_int64_t offset, int whence) {
	Input *input = (Input *)data_source;
	ogg_int64_t base = whence == SEEK_SET ? 0 : whence == SEEK_CUR
		? (ogg_int64_t)input->offset : whence == SEEK_END ? (ogg_int64_t)input->length : -1;
	if (base < 0) return -1;
	uint64_t position;
	if (offset < 0) {
		uint64_t magnitude = (uint64_t)(-(offset + 1)) + 1;
		if (magnitude > (uint64_t)base) return -1;
		position = (uint64_t)base - magnitude;
	} else {
		if ((uint64_t)offset > input->length - (uint64_t)base) return -1;
		position = (uint64_t)base + (uint64_t)offset;
	}
	input->offset = (size_t)position;
	return 0;
}

static int memory_close(void *data_source) { (void)data_source; return 0; }

static long memory_tell(void *data_source) {
	Input *input = (Input *)data_source;
	return input->offset <= LONG_MAX ? (long)input->offset : -1;
}

static int open_input(
	const unsigned char *input_bytes,
	uint32_t input_length,
	Input *input,
	OggVorbis_File *file
) {
	input->bytes = input_bytes;
	input->length = input_length;
	input->offset = 0;
	ov_callbacks callbacks = { memory_read, memory_seek, memory_close, memory_tell };
	return ov_open_callbacks(input, file, NULL, 0, callbacks) == 0;
}

int scvb_abi_version(void) { return SCVB_ABI_VERSION; }
int scvb_minimum_sample_rate(void) { return SCVB_MINIMUM_SAMPLE_RATE; }
int scvb_maximum_sample_rate(void) { return SCVB_MAXIMUM_SAMPLE_RATE; }
int scvb_maximum_channels(void) { return SCVB_MAXIMUM_CHANNELS; }
int scvb_maximum_frames(void) { return SCVB_MAXIMUM_FRAMES; }
int scvb_initial_memory_bytes(void) { return SCVB_INITIAL_MEMORY_BYTES; }
int scvb_maximum_memory_bytes(void) { return SCVB_MAXIMUM_MEMORY_BYTES; }

void *scvb_allocate(size_t bytes) {
	return bytes > 0 && bytes <= SCVB_MAXIMUM_MEMORY_BYTES ? malloc(bytes) : NULL;
}

void scvb_free(void *pointer) { free(pointer); }

int scvb_probe(
	const unsigned char *input_bytes,
	uint32_t input_length,
	uint32_t expected_frames,
	uint32_t expected_channels,
	uint32_t expected_sample_rate
) {
	if (!input_bytes || input_length == 0 || expected_frames == 0
		|| expected_frames > SCVB_MAXIMUM_FRAMES || expected_channels == 0
		|| expected_channels > SCVB_MAXIMUM_CHANNELS
		|| expected_sample_rate < SCVB_MINIMUM_SAMPLE_RATE
		|| expected_sample_rate > SCVB_MAXIMUM_SAMPLE_RATE) return 0;
	Input input;
	OggVorbis_File file;
	if (!open_input(input_bytes, input_length, &input, &file)) return 0;
	vorbis_info *info = ov_info(&file, -1);
	int valid = info && info->channels == (long)expected_channels
		&& info->rate == (long)expected_sample_rate && ov_streams(&file) == 1
		&& ov_pcm_total(&file, -1) == (ogg_int64_t)expected_frames;
	ov_clear(&file);
	return valid;
}

int scvb_validate(const unsigned char *input_bytes, uint32_t input_length) {
	if (!input_bytes || input_length == 0) return 0;
	Input input;
	OggVorbis_File file;
	if (!open_input(input_bytes, input_length, &input, &file)) return 0;
	int streams = ov_streams(&file);
	int valid = streams > 0 && streams <= 64;
	for (int stream = 0; valid && stream < streams; stream++) {
		vorbis_info *info = ov_info(&file, stream);
		valid = info && info->channels > 0 && info->rate > 0
			&& ov_pcm_total(&file, stream) > 0;
	}
	ov_clear(&file);
	return valid;
}

int scvb_encode_float32(
	const float *input,
	uint32_t frames,
	uint32_t channels,
	uint32_t sample_rate,
	uint32_t quality,
	unsigned char *output,
	uint32_t output_capacity
) {
	if (!input || !output || frames == 0 || frames > SCVB_MAXIMUM_FRAMES || channels == 0
		|| channels > SCVB_MAXIMUM_CHANNELS || sample_rate < SCVB_MINIMUM_SAMPLE_RATE
		|| sample_rate > SCVB_MAXIMUM_SAMPLE_RATE || quality > 10 || output_capacity == 0) return 0;
	vorbis_info info;
	vorbis_comment comment;
	vorbis_dsp_state dsp;
	vorbis_block block;
	ogg_stream_state stream;
	int info_initialized = 0;
	int comment_initialized = 0;
	int dsp_initialized = 0;
	int block_initialized = 0;
	int stream_initialized = 0;
	int result = 0;
	Output sink = { output, output_capacity, 0, 0 };
	vorbis_info_init(&info);
	info_initialized = 1;
	if (vorbis_encode_init_vbr(
		&info, (long)channels, (long)sample_rate, (float)quality / 10.0f
	) != 0) goto cleanup;
	vorbis_comment_init(&comment);
	comment_initialized = 1;
	vorbis_comment_add_tag(&comment, "ENCODER", "Soundscaper/1");
	if (vorbis_analysis_init(&dsp, &info) != 0) goto cleanup;
	dsp_initialized = 1;
	if (vorbis_block_init(&dsp, &block) != 0) goto cleanup;
	block_initialized = 1;
	if (ogg_stream_init(&stream, SCVB_SERIAL) != 0) goto cleanup;
	stream_initialized = 1;
	ogg_packet identification;
	ogg_packet comments;
	ogg_packet setup;
	if (vorbis_analysis_headerout(&dsp, &comment, &identification, &comments, &setup) != 0) goto cleanup;
	if (ogg_stream_packetin(&stream, &identification) != 0
		|| ogg_stream_packetin(&stream, &comments) != 0
		|| ogg_stream_packetin(&stream, &setup) != 0
		|| !drain_pages(&stream, &sink, 1)) goto cleanup;
	uint32_t consumed = 0;
	while (consumed < frames) {
		int chunk = frames - consumed > 1024 ? 1024 : (int)(frames - consumed);
		float **buffer = vorbis_analysis_buffer(&dsp, chunk);
		if (!buffer) goto cleanup;
		for (uint32_t channel = 0; channel < channels; channel++) {
			for (int frame = 0; frame < chunk; frame++) {
				buffer[channel][frame] = input[((size_t)consumed + (size_t)frame) * channels + channel];
			}
		}
		if (vorbis_analysis_wrote(&dsp, chunk) != 0
			|| !drain_packets(&dsp, &block, &stream, &sink)) goto cleanup;
		consumed += (uint32_t)chunk;
	}
	if (vorbis_analysis_wrote(&dsp, 0) != 0
		|| !drain_packets(&dsp, &block, &stream, &sink)) goto cleanup;
	if (!sink.failed && sink.length > 0 && sink.length <= INT32_MAX) result = (int)sink.length;
cleanup:
	if (stream_initialized) ogg_stream_clear(&stream);
	if (block_initialized) vorbis_block_clear(&block);
	if (dsp_initialized) vorbis_dsp_clear(&dsp);
	if (comment_initialized) vorbis_comment_clear(&comment);
	if (info_initialized) vorbis_info_clear(&info);
	return result;
}

int scvb_decode_float32(
	const unsigned char *input_bytes,
	uint32_t input_length,
	uint32_t expected_frames,
	uint32_t expected_channels,
	uint32_t expected_sample_rate,
	float *output,
	uint32_t output_bytes
) {
	uint64_t required = (uint64_t)expected_frames * expected_channels * sizeof(float);
	if (!input_bytes || !output || input_length == 0 || expected_frames == 0
		|| expected_frames > SCVB_MAXIMUM_FRAMES || expected_channels == 0
		|| expected_channels > SCVB_MAXIMUM_CHANNELS
		|| expected_sample_rate < SCVB_MINIMUM_SAMPLE_RATE
		|| expected_sample_rate > SCVB_MAXIMUM_SAMPLE_RATE
		|| required > UINT32_MAX || output_bytes != required) return 0;
	Input input;
	OggVorbis_File file;
	if (!open_input(input_bytes, input_length, &input, &file)) return 0;
	int result = 0;
	vorbis_info *info = ov_info(&file, -1);
	if (!info || info->channels != (long)expected_channels
		|| info->rate != (long)expected_sample_rate || ov_streams(&file) != 1
		|| ov_pcm_total(&file, -1) != (ogg_int64_t)expected_frames) goto cleanup;
	uint32_t written = 0;
	while (written < expected_frames) {
		float **pcm = NULL;
		int bitstream = 0;
		long available = ov_read_float(&file, &pcm, (int)(expected_frames - written), &bitstream);
		if (available <= 0 || bitstream != 0 || !pcm) goto cleanup;
		for (long frame = 0; frame < available; frame++) {
			for (uint32_t channel = 0; channel < expected_channels; channel++) {
				output[((size_t)written + (size_t)frame) * expected_channels + channel] = pcm[channel][frame];
			}
		}
		written += (uint32_t)available;
	}
	float **extra = NULL;
	int bitstream = 0;
	if (ov_read_float(&file, &extra, 1, &bitstream) != 0) goto cleanup;
	result = (int)written;
cleanup:
	ov_clear(&file);
	return result;
}
