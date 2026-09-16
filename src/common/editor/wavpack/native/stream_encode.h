/* SPDX-License-Identifier: AGPL-3.0-only */
#define SCWP_STREAM_BYTES (1024 * 1024)
typedef struct {
	WavpackContext *encoder;
	ScwpOutput sink;
	uint32_t total, received, channels;
	int finished;
	unsigned char output[SCWP_STREAM_BYTES];
} ScwpStream;

void scwp_stream_close(ScwpStream *session) {
	if (!session) return;
	if (session->encoder) WavpackCloseFile(session->encoder);
	free(session);
}

ScwpStream *scwp_stream_open(uint32_t total, uint32_t channels, uint32_t rate, uint32_t unused1, uint32_t unused2) {
	(void)unused1; (void)unused2;
	if (!total || rate < 8000 || rate > 192000 || total > rate * 3600u || !channels || channels > 8) return NULL;
	ScwpStream *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	session->sink.data = session->output; session->sink.capacity = SCWP_STREAM_BYTES;
	session->encoder = WavpackOpenFileOutput(block_output, &session->sink, NULL);
	WavpackConfig config;
	memset(&config, 0, sizeof(config));
	config.bits_per_sample = 32; config.bytes_per_sample = 4;
	config.num_channels = channels; config.sample_rate = rate; config.float_norm_exp = 127;
	config.block_samples = 16384; config.flags = CONFIG_FAST_FLAG | CONFIG_PAIR_UNDEF_CHANS;
	if (!session->encoder || !WavpackSetConfiguration64(session->encoder, &config, total, NULL) || !WavpackPackInit(session->encoder)) {
		scwp_stream_close(session); return NULL;
	}
	session->total = total; session->channels = channels;
	return session;
}

int scwp_stream_write(ScwpStream *session, const int32_t *input, uint32_t frames) {
	if (!session || !input || session->finished || !frames || frames > 16384
		|| frames > session->total - session->received) return 0;
	// The streaming ABI consumes interleaved IEEE Float32 words directly.
	if (!WavpackPackSamples(session->encoder, (int32_t *)input, frames) || session->sink.overflow) return 0;
	session->received += frames; return 1;
}

int scwp_stream_finish(ScwpStream *session) {
	if (!session || session->finished || session->received != session->total) return 0;
	if (!WavpackFlushSamples(session->encoder) || session->sink.overflow) return 0;
	session->finished = 1; return 1;
}

int scwp_stream_read(ScwpStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !output || capacity < session->sink.size) return -1;
	int length = session->sink.size;
	memcpy(output, session->output, length); session->sink.size = 0;
	return length;
}

int scwp_stream_patch(ScwpStream *session, unsigned char *output, uint32_t capacity) {
	(void)session; (void)output; (void)capacity; return 0;
}
