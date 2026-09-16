/* SPDX-License-Identifier: AGPL-3.0-only */

typedef struct { OpusDecoder *decoder; uint32_t channels; } ScopStreamDecode;

void *scop_stream_decode_open(const unsigned char *description, uint32_t length, uint32_t rate, uint32_t channels) {
	if (rate != 48000 || channels < 1 || channels > 2 || !description || length < 19
		|| memcmp(description, "OpusHead", 8) || description[9] != channels || description[18] != 0) return NULL;
	ScopStreamDecode *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	int error = 0;
	session->decoder = opus_decoder_create((int)rate, (int)channels, &error);
	session->channels = channels;
	if (!session->decoder || error != OPUS_OK) { opus_decoder_destroy(session->decoder); free(session); return NULL; }
	return session;
}

int scop_stream_decode_push(void *handle, const unsigned char *input, uint32_t length, float *output, uint32_t capacity_frames) {
	ScopStreamDecode *session = handle;
	if (!session || !input || length < 1 || length > 65536 || !output || capacity_frames > 65536 || capacity_frames < 5760) return -1;
	return opus_decode_float(session->decoder, input, (opus_int32)length, output, (int)capacity_frames, 0);
}

void scop_stream_decode_close(void *handle) {
	ScopStreamDecode *session = handle;
	if (!session) return;
	opus_decoder_destroy(session->decoder);
	free(session);
}
