/* SPDX-License-Identifier: AGPL-3.0-only */

#include <stdint.h>
#include "nyx.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NYQ_ABI_VERSION 1
#define NYQ_MAX_CHANNELS 32
#define NYQ_MAX_SOURCE_BYTES (4 * 1024 * 1024)
#define NYQ_MAX_OUTPUT_BYTES (1024 * 1024)

typedef struct NyquistSession {
    double sample_rate;
    int channels;
    int frames;
    float **input;
    float **audio;
    int *audio_capacity;
    int *audio_written;
    int audio_channels;
    int audio_frames;
    int render_limit;
    int render_failed;
    int render_truncated;
    nyx_rval result_type;
    char *output;
    size_t output_size;
    size_t output_capacity;
    char error[256];
} NyquistSession;

static NyquistSession *active_session;

static void set_error(NyquistSession *session, const char *message)
{
    if (!session) {
        return;
    }
    snprintf(session->error, sizeof(session->error), "%s", message ? message : "Nyquist failed.");
}

static void clear_audio(NyquistSession *session)
{
    int channel;
    if (!session) {
        return;
    }
    if (session->audio) {
        for (channel = 0; channel < session->audio_channels; channel++) {
            free(session->audio[channel]);
        }
    }
    free(session->audio);
    free(session->audio_capacity);
    free(session->audio_written);
    session->audio = NULL;
    session->audio_capacity = NULL;
    session->audio_written = NULL;
    session->audio_channels = 0;
    session->audio_frames = 0;
}

static void clear_output(NyquistSession *session)
{
    if (!session) {
        return;
    }
    session->output_size = 0;
    if (session->output) {
        session->output[0] = '\0';
    }
}

static int reserve_output(NyquistSession *session, size_t needed)
{
    size_t capacity;
    char *next;
    if (needed > NYQ_MAX_OUTPUT_BYTES + 1) {
        return -1;
    }
    if (needed <= session->output_capacity) {
        return 0;
    }
    capacity = session->output_capacity ? session->output_capacity : 1024;
    while (capacity < needed) {
        capacity *= 2;
    }
    if (capacity > NYQ_MAX_OUTPUT_BYTES + 1) {
        capacity = NYQ_MAX_OUTPUT_BYTES + 1;
    }
    next = (char *)realloc(session->output, capacity);
    if (!next) {
        return -1;
    }
    session->output = next;
    session->output_capacity = capacity;
    return 0;
}

static void capture_output(int character, void *userdata)
{
    NyquistSession *session = (NyquistSession *)userdata;
    if (!session || session->output_size >= NYQ_MAX_OUTPUT_BYTES) {
        return;
    }
    if (reserve_output(session, session->output_size + 2) != 0) {
        return;
    }
    session->output[session->output_size++] = (char)character;
    session->output[session->output_size] = '\0';
}

static int read_input(float *buffer, int channel, int64_t start, int64_t len,
                      int64_t total, void *userdata)
{
    NyquistSession *session = (NyquistSession *)userdata;
    (void)total;
    if (!session || !buffer || channel < 0 || channel >= session->channels ||
        start < 0 || len < 0 || start > session->frames ||
        len > session->frames - start) {
        return -1;
    }
    memcpy(buffer, session->input[channel] + (size_t)start,
           (size_t)len * sizeof(float));
    return 0;
}

static int reserve_audio_channel(NyquistSession *session, int channel, int frames)
{
    int capacity;
    float *next;
    if (frames <= session->audio_capacity[channel]) {
        return 0;
    }
    capacity = session->audio_capacity[channel] ? session->audio_capacity[channel] : 4096;
    while (capacity < frames && capacity < session->render_limit) {
        if (capacity > session->render_limit / 2) {
            capacity = session->render_limit;
        } else {
            capacity *= 2;
        }
    }
    if (capacity < frames) {
        return -1;
    }
    next = (float *)realloc(session->audio[channel], (size_t)capacity * sizeof(float));
    if (!next) {
        return -1;
    }
    session->audio[channel] = next;
    session->audio_capacity[channel] = capacity;
    return 0;
}

static int write_audio(float *buffer, int channel, int64_t start, int64_t len,
                       int64_t total, void *userdata)
{
    NyquistSession *session = (NyquistSession *)userdata;
    int copy_frames;
    int end;
    (void)total;
    if (!session || !buffer || channel < 0 || channel >= session->audio_channels ||
        start < 0 || len < 0 || start > INT32_MAX || len > INT32_MAX - start) {
        session->render_failed = 1;
        return -1;
    }
    if (start >= session->render_limit) {
        session->render_truncated = 1;
        return -1;
    }
    copy_frames = (int)len;
    if (copy_frames > session->render_limit - (int)start) {
        copy_frames = session->render_limit - (int)start;
        session->render_truncated = 1;
    }
    end = (int)start + copy_frames;
    if (reserve_audio_channel(session, channel, end) != 0) {
        session->render_failed = 1;
        return -1;
    }
    memcpy(session->audio[channel] + (size_t)start, buffer, (size_t)copy_frames * sizeof(float));
    session->audio_written[channel] = end;
    if (end > session->audio_frames) {
        session->audio_frames = end;
    }
    return 0;
}

int nyq_abi_version(void)
{
    return NYQ_ABI_VERSION;
}

void *nyq_alloc(int bytes)
{
    if (bytes <= 0 || bytes > NYQ_MAX_SOURCE_BYTES + 1) {
        return NULL;
    }
    return malloc((size_t)bytes);
}

void nyq_free(void *pointer)
{
    free(pointer);
}

void *nyq_create(int sample_rate, int channels, int frames)
{
    NyquistSession *session;
    int channel;
    if (active_session || sample_rate < 1000 || sample_rate > 768000 ||
        channels < 0 || channels > NYQ_MAX_CHANNELS || frames < 0 ||
        ((channels == 0) != (frames == 0))) {
        return NULL;
    }
    session = (NyquistSession *)calloc(1, sizeof(*session));
    if (!session) {
        return NULL;
    }
    session->sample_rate = sample_rate;
    session->channels = channels;
    session->frames = frames;
    if (channels > 0) {
        session->input = (float **)calloc((size_t)channels, sizeof(float *));
        if (!session->input) {
            free(session);
            return NULL;
        }
        for (channel = 0; channel < channels; channel++) {
            session->input[channel] = (float *)calloc((size_t)frames, sizeof(float));
            if (!session->input[channel]) {
                while (channel-- > 0) {
                    free(session->input[channel]);
                }
                free(session->input);
                free(session);
                return NULL;
            }
        }
    }

    active_session = session;
    nyx_set_xlisp_path("/runtime");
    nyx_init();
    nyx_set_audio_name("*TRACK*");
    nyx_capture_output(capture_output, session);
    if (channels > 0) {
        nyx_set_input_audio(read_input, session, channels, frames, sample_rate);
    } else {
        nyx_set_audio_params(sample_rate, 0);
    }
    return session;
}

void nyq_destroy(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    int channel;
    if (!session || session != active_session) {
        return;
    }
    nyx_capture_output(NULL, NULL);
    nyx_cleanup();
    for (channel = 0; channel < session->channels; channel++) {
        free(session->input[channel]);
    }
    free(session->input);
    clear_audio(session);
    free(session->output);
    active_session = NULL;
    free(session);
}

float *nyq_input_pointer(void *handle, int channel)
{
    NyquistSession *session = (NyquistSession *)handle;
    if (!session || session != active_session || channel < 0 || channel >= session->channels) {
        return NULL;
    }
    return session->input[channel];
}

int nyq_eval(void *handle, const char *source, int source_bytes)
{
    NyquistSession *session = (NyquistSession *)handle;
    char *expression;
    if (!session || session != active_session || !source || source_bytes <= 0 ||
        source_bytes > NYQ_MAX_SOURCE_BYTES) {
        if (session) {
            set_error(session, "Invalid Nyquist source.");
        }
        return nyx_error;
    }
    expression = (char *)malloc((size_t)source_bytes + 1);
    if (!expression) {
        set_error(session, "Not enough memory for Nyquist source.");
        return nyx_error;
    }
    memcpy(expression, source, (size_t)source_bytes);
    expression[source_bytes] = '\0';
    clear_audio(session);
    clear_output(session);
    session->error[0] = '\0';
    session->result_type = nyx_eval_expression(expression);
    free(expression);
    if (session->result_type == nyx_error) {
        set_error(session, session->output_size ? session->output : "Nyquist evaluation failed.");
    }
    return session->result_type;
}

int nyq_render_audio(void *handle, int max_frames)
{
    NyquistSession *session = (NyquistSession *)handle;
    int channel;
    if (!session || session != active_session || session->result_type != nyx_audio ||
        max_frames <= 0) {
        if (session) {
            set_error(session, "Nyquist did not return audio.");
        }
        return -1;
    }
    clear_audio(session);
    session->audio_channels = nyx_get_audio_num_channels();
    if (session->audio_channels <= 0 || session->audio_channels > NYQ_MAX_CHANNELS) {
        set_error(session, "Nyquist returned an unsupported channel count.");
        clear_audio(session);
        return -1;
    }
    session->audio = (float **)calloc((size_t)session->audio_channels, sizeof(float *));
    session->audio_capacity = (int *)calloc((size_t)session->audio_channels, sizeof(int));
    session->audio_written = (int *)calloc((size_t)session->audio_channels, sizeof(int));
    if (!session->audio || !session->audio_capacity || !session->audio_written) {
        set_error(session, "Not enough memory for Nyquist audio.");
        clear_audio(session);
        return -1;
    }
    session->render_limit = max_frames;
    session->render_failed = 0;
    session->render_truncated = 0;
    session->audio_frames = 0;
    if ((!nyx_get_audio(write_audio, session) && !session->render_truncated) || session->render_failed) {
        set_error(session, "Nyquist audio rendering failed.");
        clear_audio(session);
        return -1;
    }
    for (channel = 0; channel < session->audio_channels; channel++) {
        if (session->audio_written[channel] != session->audio_frames) {
            set_error(session, "Nyquist returned channels with inconsistent lengths.");
            clear_audio(session);
            return -1;
        }
    }
    return 0;
}

int nyq_result_type(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? session->result_type : nyx_error;
}

int nyq_audio_channels(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? session->audio_channels : 0;
}

int nyq_audio_frames(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? session->audio_frames : 0;
}

float *nyq_audio_pointer(void *handle, int channel)
{
    NyquistSession *session = (NyquistSession *)handle;
    if (!session || session != active_session || channel < 0 || channel >= session->audio_channels) {
        return NULL;
    }
    return session->audio[channel];
}

int nyq_result_int(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? nyx_get_int() : 0;
}

double nyq_result_double(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? nyx_get_double() : NAN;
}

const char *nyq_result_string(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    const char *result = session && session == active_session ? nyx_get_string() : NULL;
    return result ? result : "";
}

int nyq_label_count(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? (int)nyx_get_num_labels() : 0;
}

double nyq_label_start(void *handle, int index)
{
    NyquistSession *session = (NyquistSession *)handle;
    double start = NAN;
    double end = NAN;
    const char *label = NULL;
    if (session && session == active_session && index >= 0 && index < nyq_label_count(handle)) {
        nyx_get_label((unsigned int)index, &start, &end, &label);
    }
    return start;
}

double nyq_label_end(void *handle, int index)
{
    NyquistSession *session = (NyquistSession *)handle;
    double start = NAN;
    double end = NAN;
    const char *label = NULL;
    if (session && session == active_session && index >= 0 && index < nyq_label_count(handle)) {
        nyx_get_label((unsigned int)index, &start, &end, &label);
    }
    return end;
}

const char *nyq_label_text(void *handle, int index)
{
    NyquistSession *session = (NyquistSession *)handle;
    double start = NAN;
    double end = NAN;
    const char *label = NULL;
    if (session && session == active_session && index >= 0 && index < nyq_label_count(handle)) {
        nyx_get_label((unsigned int)index, &start, &end, &label);
    }
    return label ? label : "";
}

const char *nyq_output(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session && session->output ? session->output : "";
}

const char *nyq_error(void *handle)
{
    NyquistSession *session = (NyquistSession *)handle;
    return session && session == active_session ? session->error : "Invalid Nyquist session.";
}
