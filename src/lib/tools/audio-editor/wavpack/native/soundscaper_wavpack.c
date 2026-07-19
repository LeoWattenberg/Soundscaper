/*
 * Soundscaper's narrow in-memory WavPack bridge.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * WavPack itself is BSD-3-Clause; see ../licenses/WAVPACK.txt.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wavpack.h"

#define SCWP_ABI_VERSION 1u
#define SCWP_MAXIMUM_CHANNELS 64u
#define SCWP_MAXIMUM_FRAMES 65536u
#define SCWP_BLOCK_SAMPLES 65536
#define SCWP_INITIAL_MEMORY_BYTES (8u * 1024u * 1024u)
#define SCWP_MAXIMUM_MEMORY_BYTES (128u * 1024u * 1024u)

#if defined(__GNUC__) || defined(__clang__)
#define SCWP_EXPORT __attribute__((used, visibility("default")))
#else
#define SCWP_EXPORT
#endif

enum {
    SCWP_ERROR_INVALID_ARGUMENT = -1,
    SCWP_ERROR_ALLOCATION = -2,
    SCWP_ERROR_CONFIGURATION = -3,
    SCWP_ERROR_OUTPUT_CAPACITY = -4,
    SCWP_ERROR_CODEC = -5,
    SCWP_ERROR_FORMAT = -6,
    SCWP_ERROR_GEOMETRY = -7,
    SCWP_ERROR_CHECKSUM = -8
};

typedef struct {
    unsigned char *data;
    uint32_t capacity;
    uint32_t size;
    int overflow;
} ScwpOutput;

typedef struct {
    const unsigned char *data;
    int64_t size;
    int64_t position;
} ScwpInput;

static int valid_geometry(uint32_t frames, uint32_t channels, uint32_t sample_rate)
{
    uint64_t words = (uint64_t)frames * channels;
    return frames > 0 && frames <= SCWP_MAXIMUM_FRAMES
        && channels > 0 && channels <= SCWP_MAXIMUM_CHANNELS
        && sample_rate > 0 && sample_rate <= 768000
        && words <= (uint64_t)SCWP_MAXIMUM_FRAMES * SCWP_MAXIMUM_CHANNELS;
}

static int block_output(void *id, void *data, int32_t byte_count)
{
    ScwpOutput *output = (ScwpOutput *)id;

    if (!output || !data || byte_count <= 0
        || (uint32_t)byte_count > output->capacity - output->size) {
        if (output)
            output->overflow = 1;

        return 0;
    }

    memcpy(output->data + output->size, data, (uint32_t)byte_count);
    output->size += (uint32_t)byte_count;
    return 1;
}

static int32_t input_read(void *id, void *data, int32_t byte_count)
{
    ScwpInput *input = (ScwpInput *)id;
    int64_t available;

    if (!input || !data || byte_count <= 0)
        return 0;

    available = input->size - input->position;

    if (available <= 0)
        return 0;

    if ((int64_t)byte_count > available)
        byte_count = (int32_t)available;

    memcpy(data, input->data + input->position, (size_t)byte_count);
    input->position += byte_count;
    return byte_count;
}

static int32_t input_write(void *id, void *data, int32_t byte_count)
{
    (void)id;
    (void)data;
    (void)byte_count;
    return 0;
}

static int64_t input_position(void *id)
{
    ScwpInput *input = (ScwpInput *)id;
    return input ? input->position : -1;
}

static int input_set_position(void *id, int64_t position)
{
    ScwpInput *input = (ScwpInput *)id;

    if (!input || position < 0 || position > input->size)
        return -1;

    input->position = position;
    return 0;
}

static int input_set_relative_position(void *id, int64_t delta, int mode)
{
    ScwpInput *input = (ScwpInput *)id;
    int64_t base;

    if (!input)
        return -1;

    if (mode == SEEK_SET)
        base = 0;
    else if (mode == SEEK_CUR)
        base = input->position;
    else if (mode == SEEK_END)
        base = input->size;
    else
        return -1;

    if ((delta > 0 && base > INT64_MAX - delta)
        || (delta < 0 && base < INT64_MIN - delta))
        return -1;

    return input_set_position(input, base + delta);
}

static int input_push_back(void *id, int value)
{
    ScwpInput *input = (ScwpInput *)id;

    if (!input || input->position <= 0
        || input->data[input->position - 1] != (unsigned char)value)
        return EOF;

    --input->position;
    return value;
}

static int64_t input_length(void *id)
{
    ScwpInput *input = (ScwpInput *)id;
    return input ? input->size : 0;
}

static int input_can_seek(void *id)
{
    return id != NULL;
}

static int input_truncate(void *id)
{
    (void)id;
    return -1;
}

static int input_close(void *id)
{
    (void)id;
    return 0;
}

static WavpackStreamReader64 memory_reader = {
    input_read,
    input_write,
    input_position,
    input_set_position,
    input_set_relative_position,
    input_push_back,
    input_length,
    input_can_seek,
    input_truncate,
    input_close
};

SCWP_EXPORT uint32_t scwp_abi_version(void)
{
    return SCWP_ABI_VERSION;
}

SCWP_EXPORT uint32_t scwp_maximum_channels(void)
{
    return SCWP_MAXIMUM_CHANNELS;
}

SCWP_EXPORT uint32_t scwp_maximum_frames(void)
{
    return SCWP_MAXIMUM_FRAMES;
}

SCWP_EXPORT uint32_t scwp_initial_memory_bytes(void)
{
    return SCWP_INITIAL_MEMORY_BYTES;
}

SCWP_EXPORT uint32_t scwp_maximum_memory_bytes(void)
{
    return SCWP_MAXIMUM_MEMORY_BYTES;
}

SCWP_EXPORT void *scwp_allocate(uint32_t bytes)
{
    return bytes ? malloc(bytes) : NULL;
}

SCWP_EXPORT void scwp_free(void *pointer)
{
    free(pointer);
}

SCWP_EXPORT int32_t scwp_encode_float32(
    const void *planar_pcm,
    uint32_t frames,
    uint32_t channels,
    uint32_t sample_rate,
    void *encoded_output,
    uint32_t output_capacity)
{
    WavpackConfig configuration;
    WavpackContext *context;
    ScwpOutput output;
    int32_t *interleaved;
    const uint32_t *planar = (const uint32_t *)planar_pcm;
    uint64_t word_count;
    uint32_t frame, channel;
    int result = SCWP_ERROR_CODEC;

    if (!planar_pcm || !encoded_output || !output_capacity
        || !valid_geometry(frames, channels, sample_rate))
        return SCWP_ERROR_INVALID_ARGUMENT;

    word_count = (uint64_t)frames * channels;

    if (word_count > SIZE_MAX / sizeof(*interleaved))
        return SCWP_ERROR_INVALID_ARGUMENT;

    interleaved = (int32_t *)malloc((size_t)word_count * sizeof(*interleaved));

    if (!interleaved)
        return SCWP_ERROR_ALLOCATION;

    for (frame = 0; frame < frames; ++frame)
        for (channel = 0; channel < channels; ++channel)
            interleaved[(uint64_t)frame * channels + channel] =
                (int32_t)planar[(uint64_t)channel * frames + frame];

    memset(&configuration, 0, sizeof(configuration));
    configuration.bits_per_sample = 32;
    configuration.bytes_per_sample = 4;
    configuration.num_channels = (int)channels;
    configuration.sample_rate = (int32_t)sample_rate;
    configuration.channel_mask = 0;
    configuration.float_norm_exp = 127;
    configuration.block_samples = SCWP_BLOCK_SAMPLES;
    configuration.flags = CONFIG_FAST_FLAG | CONFIG_PAIR_UNDEF_CHANS;

    output.data = (unsigned char *)encoded_output;
    output.capacity = output_capacity;
    output.size = 0;
    output.overflow = 0;
    context = WavpackOpenFileOutput(block_output, &output, NULL);

    if (!context) {
        result = SCWP_ERROR_ALLOCATION;
        goto cleanup_interleaved;
    }

    if (!WavpackSetConfiguration64(context, &configuration, frames, NULL)
        || !WavpackPackInit(context)) {
        result = SCWP_ERROR_CONFIGURATION;
        goto cleanup_context;
    }

    if (!WavpackPackSamples(context, interleaved, frames)
        || !WavpackFlushSamples(context)) {
        result = output.overflow
            ? SCWP_ERROR_OUTPUT_CAPACITY
            : SCWP_ERROR_CODEC;
        goto cleanup_context;
    }

    result = output.overflow
        ? SCWP_ERROR_OUTPUT_CAPACITY
        : (int32_t)output.size;

cleanup_context:
    WavpackCloseFile(context);
cleanup_interleaved:
    free(interleaved);
    return result;
}

SCWP_EXPORT int32_t scwp_decode_float32(
    const void *encoded_input,
    uint32_t input_bytes,
    uint32_t frames,
    uint32_t channels,
    uint32_t sample_rate,
    void *planar_output,
    uint32_t output_bytes)
{
    ScwpInput input;
    WavpackContext *context;
    int32_t *interleaved;
    uint32_t *planar = (uint32_t *)planar_output;
    uint64_t word_count, expected_bytes;
    uint32_t frame, channel, decoded_frames;
    char error_message[80] = { 0 };
    int result = SCWP_ERROR_CODEC;

    if (!encoded_input || !input_bytes || !planar_output
        || !valid_geometry(frames, channels, sample_rate))
        return SCWP_ERROR_INVALID_ARGUMENT;

    word_count = (uint64_t)frames * channels;
    expected_bytes = word_count * sizeof(*interleaved);

    if (expected_bytes != output_bytes || word_count > SIZE_MAX / sizeof(*interleaved))
        return SCWP_ERROR_INVALID_ARGUMENT;

    input.data = (const unsigned char *)encoded_input;
    input.size = input_bytes;
    input.position = 0;
    context = WavpackOpenFileInputEx64(
        &memory_reader,
        &input,
        NULL,
        error_message,
        0,
        0
    );

    if (!context)
        return SCWP_ERROR_FORMAT;

    if (!(WavpackGetMode(context) & MODE_LOSSLESS)
        || !(WavpackGetMode(context) & MODE_FLOAT)
        || (WavpackGetMode(context) & MODE_HYBRID)
        || WavpackLossyBlocks(context)) {
        result = SCWP_ERROR_FORMAT;
        goto cleanup_context;
    }

    if (WavpackGetNumChannels(context) != (int)channels
        || WavpackGetSampleRate(context) != sample_rate
        || WavpackGetBytesPerSample(context) != 4
        || WavpackGetBitsPerSample(context) != 32
        || WavpackGetNumSamples64(context) != frames) {
        result = SCWP_ERROR_GEOMETRY;
        goto cleanup_context;
    }

    interleaved = (int32_t *)malloc((size_t)expected_bytes);

    if (!interleaved) {
        result = SCWP_ERROR_ALLOCATION;
        goto cleanup_context;
    }

    decoded_frames = WavpackUnpackSamples(context, interleaved, frames);

    if (decoded_frames != frames || WavpackGetNumErrors(context) != 0
        || WavpackLossyBlocks(context)) {
        result = SCWP_ERROR_CHECKSUM;
        goto cleanup_interleaved;
    }

    for (frame = 0; frame < frames; ++frame)
        for (channel = 0; channel < channels; ++channel)
            planar[(uint64_t)channel * frames + frame] =
                (uint32_t)interleaved[(uint64_t)frame * channels + channel];

    result = (int32_t)output_bytes;

cleanup_interleaved:
    free(interleaved);
cleanup_context:
    WavpackCloseFile(context);
    return result;
}
