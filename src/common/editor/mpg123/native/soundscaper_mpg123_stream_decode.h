/* SPDX-License-Identifier: AGPL-3.0-only */

typedef struct { mpg123_handle *decoder; uint32_t rate; uint32_t channels; } ScmpStreamDecode;

void scmp_stream_decode_close(void *handle) {
	ScmpStreamDecode *session = handle;
	if (!session) return;
	mpg123_close(session->decoder);
	mpg123_delete(session->decoder);
	mpg123_exit();
	free(session);
}

void *scmp_stream_decode_open(const unsigned char *description, uint32_t length, uint32_t rate, uint32_t channels) {
	(void)description; (void)length;
	if ((rate != 32000 && rate != 44100 && rate != 48000) || channels < 1 || channels > 2 || mpg123_init() != MPG123_OK) return NULL;
	ScmpStreamDecode *session = calloc(1, sizeof(*session));
	if (!session) { mpg123_exit(); return NULL; }
	int error = 0;
	session->decoder = mpg123_new("generic", &error);
	session->rate = rate;
	session->channels = channels;
	if (!session->decoder || error != MPG123_OK
		|| mpg123_param(session->decoder, MPG123_FLAGS, MPG123_QUIET | MPG123_NO_RESYNC | MPG123_FORCE_FLOAT | MPG123_NO_READAHEAD, 0.0) != MPG123_OK
		|| mpg123_format_none(session->decoder) != MPG123_OK
		|| mpg123_format(session->decoder, rate, channels == 1 ? MPG123_MONO : MPG123_STEREO, MPG123_ENC_FLOAT_32) != MPG123_OK
		|| mpg123_open_feed(session->decoder) != MPG123_OK) {
		if (session->decoder) { mpg123_delete(session->decoder); } free(session); mpg123_exit(); return NULL;
	}
	return session;
}

int scmp_stream_decode_push(void *handle, const unsigned char *input, uint32_t length, float *output, uint32_t capacity_frames) {
	ScmpStreamDecode *session = handle;
	if (!session || !input || length < 1 || length > 65536 || !output || capacity_frames < 1 || capacity_frames > 65536
		|| mpg123_feed(session->decoder, input, length) != MPG123_OK) return -1;
	uint32_t written = 0;
	for (int call = 0; call < 128; call++) {
		int64_t number = 0; unsigned char *audio = NULL; size_t bytes = 0;
		int status = mpg123_decode_frame64(session->decoder, &number, &audio, &bytes);
		if (status == MPG123_NEW_FORMAT) {
			long rate = 0; int channels = 0; int encoding = 0;
			if (mpg123_getformat(session->decoder, &rate, &channels, &encoding) != MPG123_OK || rate != session->rate || channels != session->channels || encoding != MPG123_ENC_FLOAT_32) return -1;
			continue;
		}
		if (status == MPG123_NEED_MORE) return (int)written;
		if (status != MPG123_OK || bytes % (session->channels * sizeof(float))) return -1;
		uint32_t frames = (uint32_t)(bytes / (session->channels * sizeof(float)));
		if (frames > capacity_frames - written || (frames && !audio)) return -1;
		memcpy(output + (size_t)written * session->channels, audio, bytes);
		written += frames;
	}
	return -1;
}
