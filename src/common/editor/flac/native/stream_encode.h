/* SPDX-License-Identifier: AGPL-3.0-only */
#define SCFL_STREAM_BYTES (1024 * 1024)
typedef struct {
	FLAC__StreamEncoder *encoder;
	EncodeContext sink;
	uint32_t total, received, channels;
	int finished;
	FLAC__int32 converted[16384 * SCFL_MAXIMUM_CHANNELS];
	unsigned char output[SCFL_STREAM_BYTES];
} ScflStream;

void scfl_stream_close(ScflStream *session) {
	if (!session) return;
	if (session->encoder) FLAC__stream_encoder_delete(session->encoder);
	free(session);
}

ScflStream *scfl_stream_open(uint32_t total, uint32_t channels, uint32_t rate, uint32_t compression, uint32_t unused) {
	(void)unused;
	if (!total || rate < 8000 || rate > 192000 || total > rate * 3600u
		|| !channels || channels > SCFL_MAXIMUM_CHANNELS || compression > 8) return NULL;
	ScflStream *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	session->encoder = FLAC__stream_encoder_new();
	session->sink.output = session->output; session->sink.capacity = SCFL_STREAM_BYTES;
	if (!session->encoder || !FLAC__stream_encoder_set_verify(session->encoder, true)
		|| !FLAC__stream_encoder_set_compression_level(session->encoder, compression)
		|| !FLAC__stream_encoder_set_channels(session->encoder, channels)
		|| !FLAC__stream_encoder_set_bits_per_sample(session->encoder, 24)
		|| !FLAC__stream_encoder_set_sample_rate(session->encoder, rate)
		|| !FLAC__stream_encoder_set_total_samples_estimate(session->encoder, total)
		|| FLAC__stream_encoder_set_num_threads(session->encoder, 1) != 1
		|| FLAC__stream_encoder_init_stream(session->encoder, encode_write, NULL, NULL, NULL, &session->sink)
			!= FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
		scfl_stream_close(session); return NULL;
	}
	// STREAMINFO carries the known total. Non-seekable FLAC streams leave MD5 zero,
	// which the format defines as unavailable; frame CRCs and verify remain active.
	session->total = total; session->channels = channels;
	return session;
}

int scfl_stream_write(ScflStream *session, const float *input, uint32_t frames) {
	if (!session || !input || session->finished || !frames || frames > 16384
		|| frames > session->total - session->received) return 0;
	for (uint32_t index = 0; index < frames * session->channels; index++) {
		float sample = input[index];
		if (!isfinite(sample)) return 0;
		if (sample <= -1.0f) session->converted[index] = -8388608;
		else if (sample >= 1.0f) session->converted[index] = 8388607;
		else {
			double scaled = (double)sample * 8388608.0;
			FLAC__int32 rounded = (FLAC__int32)(scaled < 0.0 ? scaled - 0.5 : scaled + 0.5);
			session->converted[index] = rounded > 8388607 ? 8388607 : rounded;
		}
	}
	if (!FLAC__stream_encoder_process_interleaved(session->encoder, session->converted, frames) || session->sink.failed) return 0;
	session->received += frames;
	return 1;
}

int scfl_stream_finish(ScflStream *session) {
	if (!session || session->finished || session->received != session->total) return 0;
	if (!FLAC__stream_encoder_finish(session->encoder) || session->sink.failed) return 0;
	session->finished = 1; return 1;
}

int scfl_stream_read(ScflStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !output || capacity < session->sink.length) return -1;
	int length = session->sink.length;
	memcpy(output, session->output, length);
	session->sink.position = 0; session->sink.length = 0;
	return length;
}

int scfl_stream_patch(ScflStream *session, unsigned char *output, uint32_t capacity) {
	(void)session; (void)output; (void)capacity; return 0;
}
