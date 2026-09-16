/* SPDX-License-Identifier: AGPL-3.0-only */
#define SCLM_STREAM_BYTES (1024 * 1024)
typedef struct {
	lame_t encoder;
	uint32_t total, received, channels;
	int length, finished;
	unsigned char output[SCLM_STREAM_BYTES];
} SclmStream;

void sclm_stream_close(SclmStream *session) {
	if (!session) return;
	if (session->encoder) lame_close(session->encoder);
	free(session);
}

SclmStream *sclm_stream_open(uint32_t total, uint32_t channels, uint32_t rate, int mode, int value) {
	if (!total || rate > 48000 || rate < 8000 || total > rate * 3600u
		|| (channels != 1 && channels != 2) || !sclm_rate_arguments_admitted(mode, value)) return NULL;
	SclmStream *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	session->encoder = lame_init();
	if (!session->encoder || sclm_configure(session->encoder, total, channels, rate, mode, value) != 0) {
		sclm_stream_close(session); return NULL;
	}
	session->total = total; session->channels = channels;
	return session;
}

int sclm_stream_write(SclmStream *session, const float *input, uint32_t frames) {
	if (!session || !input || session->finished || session->length || !frames || frames > 16384
		|| frames > session->total - session->received) return 0;
	int length = session->channels == 2
		? lame_encode_buffer_interleaved_ieee_float(session->encoder, input, frames, session->output, SCLM_STREAM_BYTES)
		: lame_encode_buffer_ieee_float(session->encoder, input, input, frames, session->output, SCLM_STREAM_BYTES);
	if (length < 0) return 0;
	session->length = length; session->received += frames;
	return 1;
}

int sclm_stream_finish(SclmStream *session) {
	if (!session || session->finished || session->length || session->received != session->total) return 0;
	int length = lame_encode_flush(session->encoder, session->output, SCLM_STREAM_BYTES);
	if (length < 0) return 0;
	session->length = length; session->finished = 1;
	return 1;
}

int sclm_stream_read(SclmStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !output || capacity < (uint32_t)session->length) return -1;
	int length = session->length;
	memcpy(output, session->output, length); session->length = 0;
	return length;
}

int sclm_stream_patch(SclmStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !session->finished || !output || capacity < SCLM_FLUSH_BYTES) return -1;
	size_t length = lame_get_lametag_frame(session->encoder, output, capacity);
	return length > 0 && length <= capacity ? (int)length : -1;
}
