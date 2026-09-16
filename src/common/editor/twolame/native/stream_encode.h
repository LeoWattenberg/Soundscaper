/* SPDX-License-Identifier: AGPL-3.0-only */
#include <string.h>
#define SCTL_STREAM_BYTES (1024 * 1024)
typedef struct {
	twolame_options *encoder;
	uint32_t total, received;
	int length, finished;
	unsigned char output[SCTL_STREAM_BYTES];
} SctlStream;

void sctl_stream_close(SctlStream *session) {
	if (!session) return;
	if (session->encoder) twolame_close(&session->encoder);
	free(session);
}

SctlStream *sctl_stream_open(uint32_t total, uint32_t channels, uint32_t rate, uint32_t bitrate, uint32_t unused) {
	(void)unused;
	if (!total || total > rate * 3600u || !admitted_sample_rate(rate)
		|| !admitted_bitrate(bitrate) || !admitted_combination(channels, bitrate)) return NULL;
	SctlStream *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	session->encoder = twolame_init();
	if (!session->encoder || !configure_encoder(session->encoder, channels, rate, bitrate)) {
		sctl_stream_close(session); return NULL;
	}
	session->total = total;
	return session;
}

int sctl_stream_write(SctlStream *session, const float *input, uint32_t frames) {
	if (!session || !input || session->finished || session->length || !frames || frames > 16384
		|| frames > session->total - session->received) return 0;
	int length = twolame_encode_buffer_float32_interleaved(session->encoder, input, frames, session->output, SCTL_STREAM_BYTES);
	if (length < 0) return 0;
	session->length = length; session->received += frames;
	return 1;
}

int sctl_stream_finish(SctlStream *session) {
	if (!session || session->finished || session->length || session->received != session->total) return 0;
	int length = twolame_encode_flush(session->encoder, session->output, SCTL_STREAM_BYTES);
	if (length < 0) return 0;
	session->length = length; session->finished = 1;
	return 1;
}

int sctl_stream_read(SctlStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !output || capacity < (uint32_t)session->length) return -1;
	int length = session->length;
	memcpy(output, session->output, length); session->length = 0;
	return length;
}

int sctl_stream_patch(SctlStream *session, unsigned char *output, uint32_t capacity) {
	(void)session; (void)output; (void)capacity; return 0;
}
