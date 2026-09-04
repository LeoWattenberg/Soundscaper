/* SPDX-License-Identifier: AGPL-3.0-only */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <ogg/ogg.h>
#include <opus.h>

#define SCOP_ABI_VERSION 2
#define SCOP_SAMPLE_RATE 48000
#define SCOP_MAXIMUM_CHANNELS 2
#define SCOP_MAXIMUM_FRAMES 33554432
#define SCOP_INITIAL_MEMORY_BYTES 8388608
#define SCOP_MAXIMUM_MEMORY_BYTES 268435456
#define SCOP_FRAME_SIZE 960
#define SCOP_PACKET_BYTES 1276
#define SCOP_SERIAL 0x53434f50

/*
 * Audacity's Opus VBR Mode, ported: Off holds the bitrate constant, On lets
 * each frame take what it needs, and Constrained varies the rate while keeping
 * every frame inside the target so the stream stays usable where a decoder
 * budgets per frame.
 */
#define SCOP_VBR_MODE_OFF 0
#define SCOP_VBR_MODE_ON 1
#define SCOP_VBR_MODE_CONSTRAINED 2
#define SCOP_MAXIMUM_VBR_MODE 2

typedef struct {
	unsigned char *bytes;
	size_t capacity;
	size_t length;
	int failed;
} Output;

static void write_u16(unsigned char *output, uint16_t value) {
	output[0] = (unsigned char)(value & 255);
	output[1] = (unsigned char)(value >> 8);
}

static void write_u32(unsigned char *output, uint32_t value) {
	output[0] = (unsigned char)(value & 255);
	output[1] = (unsigned char)((value >> 8) & 255);
	output[2] = (unsigned char)((value >> 16) & 255);
	output[3] = (unsigned char)(value >> 24);
}

static uint16_t read_u16(const unsigned char *input) {
	return (uint16_t)(input[0] | ((uint16_t)input[1] << 8));
}

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

static int flush_pages(ogg_stream_state *stream, Output *output, int force) {
	ogg_page page;
	int result;
	do {
		result = force ? ogg_stream_flush(stream, &page) : ogg_stream_pageout(stream, &page);
		if (result > 0) append_page(output, &page);
	} while (result > 0 && !output->failed);
	return !output->failed;
}

int scop_abi_version(void) { return SCOP_ABI_VERSION; }
int scop_sample_rate(void) { return SCOP_SAMPLE_RATE; }
int scop_maximum_channels(void) { return SCOP_MAXIMUM_CHANNELS; }
int scop_maximum_frames(void) { return SCOP_MAXIMUM_FRAMES; }
int scop_maximum_vbr_mode(void) { return SCOP_MAXIMUM_VBR_MODE; }
int scop_initial_memory_bytes(void) { return SCOP_INITIAL_MEMORY_BYTES; }
int scop_maximum_memory_bytes(void) { return SCOP_MAXIMUM_MEMORY_BYTES; }

void *scop_allocate(size_t bytes) {
	if (bytes == 0 || bytes > SCOP_MAXIMUM_MEMORY_BYTES) return NULL;
	return malloc(bytes);
}

void scop_free(void *pointer) { free(pointer); }

int scop_encode_float32(
	const float *input,
	uint32_t frames,
	uint32_t channels,
	uint32_t bitrate,
	uint32_t vbr_mode,
	unsigned char *output,
	uint32_t output_capacity
) {
	if (!input || !output || frames == 0 || frames > SCOP_MAXIMUM_FRAMES
		|| channels == 0 || channels > SCOP_MAXIMUM_CHANNELS
		|| bitrate < 16000 || bitrate > 256000
		|| vbr_mode > SCOP_MAXIMUM_VBR_MODE || output_capacity == 0) return 0;
	int error = OPUS_OK;
	OpusEncoder *encoder = opus_encoder_create(SCOP_SAMPLE_RATE, (int)channels, OPUS_APPLICATION_AUDIO, &error);
	ogg_stream_state stream;
	int stream_initialized = 0;
	float *frame = NULL;
	Output sink = { output, output_capacity, 0, 0 };
	int result = 0;
	if (!encoder || error != OPUS_OK) goto cleanup;
	int lookahead = 0;
	int variable = vbr_mode == SCOP_VBR_MODE_OFF ? 0 : 1;
	int constrained = vbr_mode == SCOP_VBR_MODE_CONSTRAINED ? 1 : 0;
	int applied_vbr = -1;
	int applied_constraint = -1;
	if (opus_encoder_ctl(encoder, OPUS_SET_BITRATE((int)bitrate)) != OPUS_OK
		|| opus_encoder_ctl(encoder, OPUS_SET_VBR(variable)) != OPUS_OK
		|| opus_encoder_ctl(encoder, OPUS_SET_VBR_CONSTRAINT(constrained)) != OPUS_OK
		|| opus_encoder_ctl(encoder, OPUS_SET_COMPLEXITY(10)) != OPUS_OK
		|| opus_encoder_ctl(encoder, OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC)) != OPUS_OK
		|| opus_encoder_ctl(encoder, OPUS_GET_VBR(&applied_vbr)) != OPUS_OK
		|| opus_encoder_ctl(encoder, OPUS_GET_VBR_CONSTRAINT(&applied_constraint)) != OPUS_OK
		|| applied_vbr != variable || applied_constraint != constrained
		|| opus_encoder_ctl(encoder, OPUS_GET_LOOKAHEAD(&lookahead)) != OPUS_OK
		|| lookahead <= 0 || lookahead > UINT16_MAX) goto cleanup;
	if (ogg_stream_init(&stream, SCOP_SERIAL) != 0) goto cleanup;
	stream_initialized = 1;
	unsigned char head[19] = { 0 };
	memcpy(head, "OpusHead", 8);
	head[8] = 1;
	head[9] = (unsigned char)channels;
	write_u16(head + 10, (uint16_t)lookahead);
	write_u32(head + 12, SCOP_SAMPLE_RATE);
	head[18] = 0;
	ogg_packet packet = { 0 };
	packet.packet = head;
	packet.bytes = sizeof(head);
	packet.b_o_s = 1;
	packet.packetno = 0;
	if (ogg_stream_packetin(&stream, &packet) != 0 || !flush_pages(&stream, &sink, 1)) goto cleanup;
	unsigned char tags[29] = { 0 };
	memcpy(tags, "OpusTags", 8);
	write_u32(tags + 8, 13);
	memcpy(tags + 12, "Soundscaper/1", 13);
	write_u32(tags + 25, 0);
	packet.packet = tags;
	packet.bytes = sizeof(tags);
	packet.b_o_s = 0;
	packet.packetno = 1;
	if (ogg_stream_packetin(&stream, &packet) != 0 || !flush_pages(&stream, &sink, 1)) goto cleanup;
	frame = calloc((size_t)SCOP_FRAME_SIZE * channels, sizeof(float));
	if (!frame) goto cleanup;
	unsigned char encoded[SCOP_PACKET_BYTES];
	uint64_t consumed = 0;
	uint64_t needed = (uint64_t)frames + (uint64_t)lookahead;
	ogg_int64_t packet_number = 2;
	while (consumed < needed) {
		uint32_t available = consumed < frames ? frames - (uint32_t)consumed : 0;
		uint32_t copied = available < SCOP_FRAME_SIZE ? available : SCOP_FRAME_SIZE;
		memset(frame, 0, (size_t)SCOP_FRAME_SIZE * channels * sizeof(float));
		if (copied > 0) memcpy(frame, input + consumed * channels, (size_t)copied * channels * sizeof(float));
		int bytes = opus_encode_float(encoder, frame, SCOP_FRAME_SIZE, encoded, sizeof(encoded));
		if (bytes <= 0) goto cleanup;
		consumed += SCOP_FRAME_SIZE;
		int final = consumed >= needed;
		packet.packet = encoded;
		packet.bytes = bytes;
		packet.e_o_s = final;
		packet.granulepos = final ? (ogg_int64_t)frames + lookahead : (ogg_int64_t)consumed;
		packet.packetno = packet_number++;
		if (ogg_stream_packetin(&stream, &packet) != 0 || !flush_pages(&stream, &sink, final)) goto cleanup;
	}
	if (!sink.failed && sink.length > 0 && sink.length <= INT32_MAX) result = (int)sink.length;
cleanup:
	free(frame);
	if (stream_initialized) ogg_stream_clear(&stream);
	opus_encoder_destroy(encoder);
	return result;
}

int scop_decode_float32(
	const unsigned char *input,
	uint32_t input_bytes,
	uint32_t expected_frames,
	uint32_t expected_channels,
	float *output,
	uint32_t output_bytes
) {
	uint64_t required_output_bytes = (uint64_t)expected_frames * expected_channels * sizeof(float);
	if (!input || !output || input_bytes == 0 || expected_frames == 0
		|| expected_frames > SCOP_MAXIMUM_FRAMES || expected_channels == 0
		|| expected_channels > SCOP_MAXIMUM_CHANNELS
		|| required_output_bytes > UINT32_MAX || output_bytes != required_output_bytes) return 0;
	ogg_sync_state sync;
	ogg_stream_state stream;
	int sync_initialized = 0;
	int stream_initialized = 0;
	OpusDecoder *decoder = NULL;
	float *decoded = NULL;
	int result = 0;
	if (ogg_sync_init(&sync) != 0) goto cleanup;
	sync_initialized = 1;
	char *buffer = ogg_sync_buffer(&sync, input_bytes);
	if (!buffer) goto cleanup;
	memcpy(buffer, input, input_bytes);
	if (ogg_sync_wrote(&sync, input_bytes) != 0) goto cleanup;
	ogg_page page;
	ogg_packet packet;
	int packet_index = 0;
	uint32_t written = 0;
	uint16_t pre_skip = 0;
	int serial = 0;
	while (ogg_sync_pageout(&sync, &page) == 1) {
		if (!stream_initialized) {
			serial = ogg_page_serialno(&page);
			if (ogg_stream_init(&stream, serial) != 0) goto cleanup;
			stream_initialized = 1;
		}
		if (ogg_page_serialno(&page) != serial || ogg_stream_pagein(&stream, &page) != 0) goto cleanup;
		while (ogg_stream_packetout(&stream, &packet) == 1) {
			if (packet_index == 0) {
				if (packet.bytes != 19 || memcmp(packet.packet, "OpusHead", 8) != 0
					|| packet.packet[8] != 1 || packet.packet[9] != expected_channels
					|| packet.packet[18] != 0) goto cleanup;
				pre_skip = read_u16(packet.packet + 10);
				int error = OPUS_OK;
				decoder = opus_decoder_create(SCOP_SAMPLE_RATE, expected_channels, &error);
				if (!decoder || error != OPUS_OK) goto cleanup;
				decoded = malloc((size_t)SCOP_FRAME_SIZE * expected_channels * sizeof(float));
				if (!decoded) goto cleanup;
			} else if (packet_index == 1) {
				if (packet.bytes < 16 || memcmp(packet.packet, "OpusTags", 8) != 0) goto cleanup;
			} else {
				int frames = opus_decode_float(decoder, packet.packet, (opus_int32)packet.bytes,
					decoded, SCOP_FRAME_SIZE, 0);
				if (frames <= 0) goto cleanup;
				uint32_t packet_start = (uint32_t)(packet_index - 2) * SCOP_FRAME_SIZE;
				uint32_t skip = packet_start < pre_skip ? pre_skip - packet_start : 0;
				if (skip > (uint32_t)frames) skip = (uint32_t)frames;
				uint32_t available = (uint32_t)frames - skip;
				uint32_t copy = available < expected_frames - written ? available : expected_frames - written;
				if (copy > 0) {
					memcpy(output + (size_t)written * expected_channels,
						decoded + (size_t)skip * expected_channels,
						(size_t)copy * expected_channels * sizeof(float));
					written += copy;
				}
			}
			packet_index++;
		}
	}
	if (packet_index >= 3 && written == expected_frames) result = (int)written;
cleanup:
	free(decoded);
	opus_decoder_destroy(decoder);
	if (stream_initialized) ogg_stream_clear(&stream);
	if (sync_initialized) ogg_sync_clear(&sync);
	return result;
}
