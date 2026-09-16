/* SPDX-License-Identifier: AGPL-3.0-only */
#define SCVB_STREAM_BYTES (1024 * 1024)
typedef struct {
	vorbis_info info;
	vorbis_comment comment;
	vorbis_dsp_state dsp;
	vorbis_block block;
	ogg_stream_state stream;
	Output sink;
	uint32_t total, received, channels;
	int dsp_ready, block_ready, stream_ready, finished;
	unsigned char output[SCVB_STREAM_BYTES];
} ScvbStream;

void scvb_stream_close(ScvbStream *session) {
	if (!session) return;
	if (session->stream_ready) ogg_stream_clear(&session->stream);
	if (session->block_ready) vorbis_block_clear(&session->block);
	if (session->dsp_ready) vorbis_dsp_clear(&session->dsp);
	vorbis_comment_clear(&session->comment); vorbis_info_clear(&session->info);
	free(session);
}

ScvbStream *scvb_stream_open(uint32_t total, uint32_t channels, uint32_t rate, uint32_t quality, uint32_t unused) {
	(void)unused;
	if (!total || rate < 8000 || rate > 192000 || total > rate * 3600u || !channels || channels > 2 || quality > 10) return NULL;
	ScvbStream *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	vorbis_info_init(&session->info); vorbis_comment_init(&session->comment);
	session->sink.bytes = session->output; session->sink.capacity = SCVB_STREAM_BYTES;
	if (vorbis_encode_init_vbr(&session->info, channels, rate, (float)quality / 10.0f) != 0) goto failed;
	vorbis_comment_add_tag(&session->comment, "ENCODER", "Soundscaper/1");
	if (vorbis_analysis_init(&session->dsp, &session->info) != 0) goto failed;
	session->dsp_ready = 1;
	if (vorbis_block_init(&session->dsp, &session->block) != 0) goto failed;
	session->block_ready = 1;
	if (ogg_stream_init(&session->stream, SCVB_SERIAL) != 0) goto failed;
	session->stream_ready = 1;
	ogg_packet identification, comments, setup;
	if (vorbis_analysis_headerout(&session->dsp, &session->comment, &identification, &comments, &setup) != 0
		|| ogg_stream_packetin(&session->stream, &identification) != 0
		|| ogg_stream_packetin(&session->stream, &comments) != 0
		|| ogg_stream_packetin(&session->stream, &setup) != 0
		|| !drain_pages(&session->stream, &session->sink, 1)) goto failed;
	session->total = total; session->channels = channels;
	return session;
failed:
	scvb_stream_close(session); return NULL;
}

int scvb_stream_write(ScvbStream *session, const float *input, uint32_t frames) {
	if (!session || !input || session->finished || !frames || frames > 16384
		|| frames > session->total - session->received) return 0;
	for (uint32_t offset = 0; offset < frames;) {
		uint32_t count = frames - offset > 1024 ? 1024 : frames - offset;
		float **buffer = vorbis_analysis_buffer(&session->dsp, count);
		if (!buffer) return 0;
		for (uint32_t channel = 0; channel < session->channels; channel++) {
			for (uint32_t frame = 0; frame < count; frame++) buffer[channel][frame] = input[(offset + frame) * session->channels + channel];
		}
		if (vorbis_analysis_wrote(&session->dsp, count) != 0
			|| !drain_packets(&session->dsp, &session->block, &session->stream, &session->sink)) return 0;
		offset += count;
	}
	session->received += frames; return 1;
}

int scvb_stream_finish(ScvbStream *session) {
	if (!session || session->finished || session->received != session->total) return 0;
	if (vorbis_analysis_wrote(&session->dsp, 0) != 0
		|| !drain_packets(&session->dsp, &session->block, &session->stream, &session->sink)) return 0;
	session->finished = 1; return 1;
}

int scvb_stream_read(ScvbStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !output || capacity < session->sink.length) return -1;
	int length = session->sink.length;
	memcpy(output, session->output, length); session->sink.length = 0;
	return length;
}

int scvb_stream_patch(ScvbStream *session, unsigned char *output, uint32_t capacity) {
	(void)session; (void)output; (void)capacity; return 0;
}
