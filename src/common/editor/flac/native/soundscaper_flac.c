/* SPDX-License-Identifier: AGPL-3.0-only */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <FLAC/stream_decoder.h>
#include <FLAC/stream_encoder.h>

#define SCFL_ABI_VERSION 1
#define SCFL_MAXIMUM_CHANNELS 8
#define SCFL_MAXIMUM_FRAMES 33554432
#define SCFL_INITIAL_MEMORY_BYTES 8388608
#define SCFL_MAXIMUM_MEMORY_BYTES 268435456
#define SCFL_CONVERSION_FRAMES 4096

typedef struct {
	FLAC__byte *output;
	size_t capacity;
	size_t position;
	size_t length;
	int failed;
} EncodeContext;

typedef struct {
	const FLAC__byte *input;
	size_t input_bytes;
	size_t input_position;
	float *output;
	size_t output_frames;
	size_t output_capacity_frames;
	uint32_t expected_channels;
	uint32_t expected_sample_rate;
	uint64_t expected_frames;
	int metadata_seen;
	int failed;
} DecodeContext;

static FLAC__StreamEncoderWriteStatus encode_write(
	const FLAC__StreamEncoder *encoder,
	const FLAC__byte buffer[],
	size_t bytes,
	uint32_t samples,
	uint32_t current_frame,
	void *client_data
) {
	EncodeContext *context = (EncodeContext *)client_data;
	(void)encoder;
	(void)samples;
	(void)current_frame;
	if (context->failed || bytes > context->capacity - context->position) {
		context->failed = 1;
		return FLAC__STREAM_ENCODER_WRITE_STATUS_FATAL_ERROR;
	}
	memcpy(context->output + context->position, buffer, bytes);
	context->position += bytes;
	if (context->position > context->length) context->length = context->position;
	return FLAC__STREAM_ENCODER_WRITE_STATUS_OK;
}

static FLAC__StreamEncoderSeekStatus encode_seek(
	const FLAC__StreamEncoder *encoder,
	FLAC__uint64 absolute_byte_offset,
	void *client_data
) {
	EncodeContext *context = (EncodeContext *)client_data;
	(void)encoder;
	if (context->failed || absolute_byte_offset > context->length) {
		context->failed = 1;
		return FLAC__STREAM_ENCODER_SEEK_STATUS_ERROR;
	}
	context->position = (size_t)absolute_byte_offset;
	return FLAC__STREAM_ENCODER_SEEK_STATUS_OK;
}

static FLAC__StreamEncoderTellStatus encode_tell(
	const FLAC__StreamEncoder *encoder,
	FLAC__uint64 *absolute_byte_offset,
	void *client_data
) {
	EncodeContext *context = (EncodeContext *)client_data;
	(void)encoder;
	if (context->failed) return FLAC__STREAM_ENCODER_TELL_STATUS_ERROR;
	*absolute_byte_offset = (FLAC__uint64)context->position;
	return FLAC__STREAM_ENCODER_TELL_STATUS_OK;
}

static FLAC__StreamDecoderReadStatus decode_read(
	const FLAC__StreamDecoder *decoder,
	FLAC__byte buffer[],
	size_t *bytes,
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	if (context->failed || *bytes == 0) {
		*bytes = 0;
		return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
	}
	if (context->input_position == context->input_bytes) {
		*bytes = 0;
		return FLAC__STREAM_DECODER_READ_STATUS_END_OF_STREAM;
	}
	size_t available = context->input_bytes - context->input_position;
	if (*bytes > available) *bytes = available;
	memcpy(buffer, context->input + context->input_position, *bytes);
	context->input_position += *bytes;
	return FLAC__STREAM_DECODER_READ_STATUS_CONTINUE;
}

static FLAC__StreamDecoderSeekStatus decode_seek(
	const FLAC__StreamDecoder *decoder,
	FLAC__uint64 absolute_byte_offset,
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	if (context->failed || absolute_byte_offset > context->input_bytes) {
		return FLAC__STREAM_DECODER_SEEK_STATUS_ERROR;
	}
	context->input_position = (size_t)absolute_byte_offset;
	return FLAC__STREAM_DECODER_SEEK_STATUS_OK;
}

static FLAC__StreamDecoderTellStatus decode_tell(
	const FLAC__StreamDecoder *decoder,
	FLAC__uint64 *absolute_byte_offset,
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	if (context->failed) return FLAC__STREAM_DECODER_TELL_STATUS_ERROR;
	*absolute_byte_offset = (FLAC__uint64)context->input_position;
	return FLAC__STREAM_DECODER_TELL_STATUS_OK;
}

static FLAC__StreamDecoderLengthStatus decode_length(
	const FLAC__StreamDecoder *decoder,
	FLAC__uint64 *stream_length,
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	if (context->failed) return FLAC__STREAM_DECODER_LENGTH_STATUS_ERROR;
	*stream_length = (FLAC__uint64)context->input_bytes;
	return FLAC__STREAM_DECODER_LENGTH_STATUS_OK;
}

static FLAC__bool decode_eof(const FLAC__StreamDecoder *decoder, void *client_data) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	return context->input_position == context->input_bytes;
}

static void decode_metadata(
	const FLAC__StreamDecoder *decoder,
	const FLAC__StreamMetadata *metadata,
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	if (metadata->type != FLAC__METADATA_TYPE_STREAMINFO || context->metadata_seen
		|| metadata->data.stream_info.channels != context->expected_channels
		|| metadata->data.stream_info.sample_rate != context->expected_sample_rate
		|| metadata->data.stream_info.total_samples != context->expected_frames) {
		context->failed = 1;
		return;
	}
	context->metadata_seen = 1;
}

static FLAC__StreamDecoderWriteStatus decode_write(
	const FLAC__StreamDecoder *decoder,
	const FLAC__Frame *frame,
	const FLAC__int32 *const buffer[],
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	uint32_t channels = frame->header.channels;
	uint32_t sample_rate = frame->header.sample_rate;
	uint32_t bits_per_sample = frame->header.bits_per_sample;
	uint32_t blocksize = frame->header.blocksize;
	if (context->failed || !context->metadata_seen
		|| channels != context->expected_channels
		|| sample_rate != context->expected_sample_rate
		|| bits_per_sample < 4 || bits_per_sample > 32
		|| blocksize == 0
		|| blocksize > context->output_capacity_frames - context->output_frames) {
		context->failed = 1;
		return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
	}
	double divisor = ldexp(1.0, (int)bits_per_sample - 1);
	for (uint32_t frame_index = 0; frame_index < blocksize; frame_index++) {
		for (uint32_t channel = 0; channel < channels; channel++) {
			context->output[(context->output_frames + frame_index) * channels + channel]
				= (float)((double)buffer[channel][frame_index] / divisor);
		}
	}
	context->output_frames += blocksize;
	return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
}

static void decode_error(
	const FLAC__StreamDecoder *decoder,
	FLAC__StreamDecoderErrorStatus status,
	void *client_data
) {
	DecodeContext *context = (DecodeContext *)client_data;
	(void)decoder;
	(void)status;
	context->failed = 1;
}

int scfl_abi_version(void) { return SCFL_ABI_VERSION; }
int scfl_maximum_channels(void) { return SCFL_MAXIMUM_CHANNELS; }
int scfl_maximum_frames(void) { return SCFL_MAXIMUM_FRAMES; }
int scfl_initial_memory_bytes(void) { return SCFL_INITIAL_MEMORY_BYTES; }
int scfl_maximum_memory_bytes(void) { return SCFL_MAXIMUM_MEMORY_BYTES; }

void *scfl_allocate(size_t bytes) {
	if (bytes == 0 || bytes > SCFL_MAXIMUM_MEMORY_BYTES) return NULL;
	return malloc(bytes);
}

void scfl_free(void *pointer) { free(pointer); }

int scfl_encode_float32(
	const float *input,
	uint32_t frames,
	uint32_t channels,
	uint32_t sample_rate,
	uint32_t compression_level,
	FLAC__byte *output,
	uint32_t output_capacity
) {
	if (!input || !output || frames == 0 || frames > SCFL_MAXIMUM_FRAMES
		|| channels == 0 || channels > SCFL_MAXIMUM_CHANNELS
		|| sample_rate < 8000 || sample_rate > 192000
		|| compression_level > 8 || output_capacity == 0) return 0;
	FLAC__StreamEncoder *encoder = FLAC__stream_encoder_new();
	if (!encoder) return 0;
	EncodeContext context = { output, output_capacity, 0, 0, 0 };
	FLAC__int32 *converted = NULL;
	int result = 0;
	if (!FLAC__stream_encoder_set_verify(encoder, true)
		|| !FLAC__stream_encoder_set_compression_level(encoder, compression_level)
		|| !FLAC__stream_encoder_set_channels(encoder, channels)
		|| !FLAC__stream_encoder_set_bits_per_sample(encoder, 24)
		|| !FLAC__stream_encoder_set_sample_rate(encoder, sample_rate)
		|| !FLAC__stream_encoder_set_total_samples_estimate(encoder, frames)
		|| FLAC__stream_encoder_set_num_threads(encoder, 1) != 1
		|| FLAC__stream_encoder_init_stream(
			encoder, encode_write, encode_seek, encode_tell, NULL, &context
		) != FLAC__STREAM_ENCODER_INIT_STATUS_OK) goto cleanup;
	converted = malloc(SCFL_CONVERSION_FRAMES * channels * sizeof(FLAC__int32));
	if (!converted) goto cleanup;
	for (uint32_t offset = 0; offset < frames;) {
		uint32_t chunk_frames = frames - offset;
		if (chunk_frames > SCFL_CONVERSION_FRAMES) chunk_frames = SCFL_CONVERSION_FRAMES;
		for (uint32_t index = 0; index < chunk_frames * channels; index++) {
			float sample = input[offset * channels + index];
			if (!isfinite(sample)) goto cleanup;
			if (sample <= -1.0f) converted[index] = -8388608;
			else if (sample >= 1.0f) converted[index] = 8388607;
			else {
				double scaled = (double)sample * 8388608.0;
				converted[index] = (FLAC__int32)(scaled < 0.0 ? scaled - 0.5 : scaled + 0.5);
			}
		}
		if (!FLAC__stream_encoder_process_interleaved(encoder, converted, chunk_frames)) goto cleanup;
		offset += chunk_frames;
	}
	if (!FLAC__stream_encoder_finish(encoder) || context.failed || context.length == 0
		|| context.length > output_capacity) goto cleanup;
	result = (int)context.length;

cleanup:
	free(converted);
	FLAC__stream_encoder_delete(encoder);
	return result;
}

int scfl_decode_float32(
	const FLAC__byte *input,
	uint32_t input_bytes,
	uint32_t expected_frames,
	uint32_t expected_channels,
	uint32_t expected_sample_rate,
	float *output,
	uint32_t output_bytes
) {
	uint64_t expected_output_bytes = (uint64_t)expected_frames * expected_channels * sizeof(float);
	if (!input || !output || input_bytes < 42 || expected_frames == 0
		|| expected_frames > SCFL_MAXIMUM_FRAMES
		|| expected_channels == 0 || expected_channels > SCFL_MAXIMUM_CHANNELS
		|| expected_sample_rate < 8000 || expected_sample_rate > 192000
		|| expected_output_bytes != output_bytes) return 0;
	FLAC__StreamDecoder *decoder = FLAC__stream_decoder_new();
	if (!decoder) return 0;
	DecodeContext context = {
		input, input_bytes, 0, output, 0, expected_frames,
		expected_channels, expected_sample_rate, expected_frames, 0, 0,
	};
	int result = 0;
	if (!FLAC__stream_decoder_set_md5_checking(decoder, true)
		|| FLAC__stream_decoder_init_stream(
			decoder, decode_read, decode_seek, decode_tell, decode_length, decode_eof,
			decode_write, decode_metadata, decode_error, &context
		) != FLAC__STREAM_DECODER_INIT_STATUS_OK) goto cleanup;
	FLAC__bool processed = FLAC__stream_decoder_process_until_end_of_stream(decoder);
	FLAC__bool finished = FLAC__stream_decoder_finish(decoder);
	if (!processed || !finished || context.failed || !context.metadata_seen
		|| context.output_frames != expected_frames) goto cleanup;
	result = (int)expected_output_bytes;

cleanup:
	FLAC__stream_decoder_delete(decoder);
	return result;
}
