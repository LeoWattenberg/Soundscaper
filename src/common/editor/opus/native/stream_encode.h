/* SPDX-License-Identifier: AGPL-3.0-only */
#define SCOP_STREAM_BYTES (1024 * 1024)
typedef struct {
	OpusEncoder *encoder;
	ogg_stream_state stream;
	Output sink;
	uint32_t total, received, channels, partial, lookahead;
	uint64_t consumed;
	ogg_int64_t packet_number;
	int stream_ready, finished;
	float frame[SCOP_FRAME_SIZE * SCOP_MAXIMUM_CHANNELS];
	unsigned char output[SCOP_STREAM_BYTES];
} ScopStream;

void scop_stream_close(ScopStream *session) {
	if (!session) return;
	if (session->stream_ready) ogg_stream_clear(&session->stream);
	opus_encoder_destroy(session->encoder); free(session);
}

ScopStream *scop_stream_open(uint32_t total, uint32_t channels, uint32_t rate, uint32_t bitrate, uint32_t mode) {
	if (!total || rate != SCOP_SAMPLE_RATE || total > rate * 3600u || !channels || channels > 2
		|| bitrate < 16000 || bitrate > 256000 || mode > SCOP_MAXIMUM_VBR_MODE) return NULL;
	ScopStream *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	int error = OPUS_OK, lookahead = 0;
	session->encoder = opus_encoder_create(rate, channels, OPUS_APPLICATION_AUDIO, &error);
	session->sink.bytes = session->output; session->sink.capacity = SCOP_STREAM_BYTES;
	if (!session->encoder || error != OPUS_OK
		|| opus_encoder_ctl(session->encoder, OPUS_SET_BITRATE((int)bitrate)) != OPUS_OK
		|| opus_encoder_ctl(session->encoder, OPUS_SET_VBR(mode != SCOP_VBR_MODE_OFF)) != OPUS_OK
		|| opus_encoder_ctl(session->encoder, OPUS_SET_VBR_CONSTRAINT(mode == SCOP_VBR_MODE_CONSTRAINED)) != OPUS_OK
		|| opus_encoder_ctl(session->encoder, OPUS_SET_COMPLEXITY(10)) != OPUS_OK
		|| opus_encoder_ctl(session->encoder, OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC)) != OPUS_OK
		|| opus_encoder_ctl(session->encoder, OPUS_GET_LOOKAHEAD(&lookahead)) != OPUS_OK
		|| lookahead <= 0 || lookahead > UINT16_MAX) goto failed;
	if (ogg_stream_init(&session->stream, SCOP_SERIAL) != 0) goto failed;
	session->stream_ready = 1;
	unsigned char head[19] = { 0 }, tags[29] = { 0 };
	memcpy(head, "OpusHead", 8); head[8] = 1; head[9] = channels;
	write_u16(head + 10, lookahead); write_u32(head + 12, rate);
	ogg_packet packet = { 0 };
	packet.packet = head; packet.bytes = sizeof(head); packet.b_o_s = 1;
	if (ogg_stream_packetin(&session->stream, &packet) != 0 || !flush_pages(&session->stream, &session->sink, 1)) goto failed;
	memcpy(tags, "OpusTags", 8); write_u32(tags + 8, 13); memcpy(tags + 12, "Soundscaper/1", 13);
	packet.packet = tags; packet.bytes = sizeof(tags); packet.b_o_s = 0; packet.packetno = 1;
	if (ogg_stream_packetin(&session->stream, &packet) != 0 || !flush_pages(&session->stream, &session->sink, 1)) goto failed;
	session->total = total; session->channels = channels; session->lookahead = lookahead; session->packet_number = 2;
	return session;
failed:
	scop_stream_close(session); return NULL;
}

static int scop_stream_frame(ScopStream *session, int final) {
	unsigned char encoded[SCOP_PACKET_BYTES];
	int bytes = opus_encode_float(session->encoder, session->frame, SCOP_FRAME_SIZE, encoded, sizeof(encoded));
	if (bytes <= 0) return 0;
	session->consumed += SCOP_FRAME_SIZE;
	ogg_packet packet = { 0 };
	packet.packet = encoded; packet.bytes = bytes; packet.e_o_s = final;
	packet.granulepos = final ? (ogg_int64_t)session->total + session->lookahead : (ogg_int64_t)session->consumed;
	packet.packetno = session->packet_number++;
	session->partial = 0;
	memset(session->frame, 0, sizeof(session->frame));
	return ogg_stream_packetin(&session->stream, &packet) == 0 && flush_pages(&session->stream, &session->sink, final);
}

int scop_stream_write(ScopStream *session, const float *input, uint32_t frames) {
	if (!session || !input || session->finished || !frames || frames > 16384
		|| frames > session->total - session->received) return 0;
	for (uint32_t offset = 0; offset < frames;) {
		uint32_t count = frames - offset;
		if (count > SCOP_FRAME_SIZE - session->partial) count = SCOP_FRAME_SIZE - session->partial;
		memcpy(session->frame + session->partial * session->channels, input + offset * session->channels, (size_t)count * session->channels * sizeof(float));
		session->partial += count; offset += count;
		if (session->partial == SCOP_FRAME_SIZE && !scop_stream_frame(session, 0)) return 0;
	}
	session->received += frames; return 1;
}

int scop_stream_finish(ScopStream *session) {
	if (!session || session->finished || session->received != session->total) return 0;
	uint64_t needed = (uint64_t)session->total + session->lookahead;
	while (session->consumed < needed) {
		if (!scop_stream_frame(session, session->consumed + SCOP_FRAME_SIZE >= needed)) return 0;
	}
	session->finished = 1; return 1;
}

int scop_stream_read(ScopStream *session, unsigned char *output, uint32_t capacity) {
	if (!session || !output || capacity < session->sink.length) return -1;
	int length = session->sink.length;
	memcpy(output, session->output, length); session->sink.length = 0;
	return length;
}

int scop_stream_patch(ScopStream *session, unsigned char *output, uint32_t capacity) {
	(void)session; (void)output; (void)capacity; return 0;
}
