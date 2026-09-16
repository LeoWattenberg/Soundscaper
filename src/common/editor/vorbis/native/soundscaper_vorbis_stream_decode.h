/* SPDX-License-Identifier: AGPL-3.0-only */

typedef struct {
	vorbis_info info;
	vorbis_comment comment;
	vorbis_dsp_state dsp;
	vorbis_block block;
	uint32_t channels;
	int dsp_ready;
	int block_ready;
} ScvbStreamDecode;

void scvb_stream_decode_close(void *handle) {
	ScvbStreamDecode *session = handle;
	if (!session) return;
	if (session->block_ready) vorbis_block_clear(&session->block);
	if (session->dsp_ready) vorbis_dsp_clear(&session->dsp);
	vorbis_comment_clear(&session->comment);
	vorbis_info_clear(&session->info);
	free(session);
}

void *scvb_stream_decode_open(const unsigned char *description, uint32_t length, uint32_t rate, uint32_t channels) {
	if (!description || length < 4 || length > 262144 || description[0] != 2
		|| channels < 1 || channels > 2 || rate < 8000 || rate > 192000) return NULL;
	uint32_t sizes[3] = {0, 0, 0};
	uint32_t position = 1;
	for (int index = 0; index < 2; index++) {
		unsigned int byte;
		do { if (position >= length) return NULL; byte = description[position++]; sizes[index] += byte; } while (byte == 255);
	}
	if (sizes[0] > length - position || sizes[1] > length - position - sizes[0]) return NULL;
	sizes[2] = length - position - sizes[0] - sizes[1];
	ScvbStreamDecode *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	vorbis_info_init(&session->info);
	vorbis_comment_init(&session->comment);
	session->channels = channels;
	for (int index = 0; index < 3; index++) {
		ogg_packet packet = {0};
		packet.packet = (unsigned char *)description + position;
		packet.bytes = sizes[index];
		packet.b_o_s = index == 0;
		if (!sizes[index] || vorbis_synthesis_headerin(&session->info, &session->comment, &packet)) goto failed;
		position += sizes[index];
	}
	if (session->info.channels != channels || session->info.rate != rate || vorbis_synthesis_init(&session->dsp, &session->info)) goto failed;
	session->dsp_ready = 1;
	if (vorbis_block_init(&session->dsp, &session->block)) goto failed;
	session->block_ready = 1;
	return session;
failed:
	scvb_stream_decode_close(session);
	return NULL;
}

int scvb_stream_decode_push(void *handle, const unsigned char *input, uint32_t length, float *output, uint32_t capacity_frames) {
	ScvbStreamDecode *session = handle;
	if (!session || !input || length < 1 || length > 1048576 || !output || capacity_frames < 1 || capacity_frames > 65536) return -1;
	ogg_packet packet = {0};
	packet.packet = (unsigned char *)input;
	packet.bytes = length;
	if (vorbis_synthesis(&session->block, &packet) || vorbis_synthesis_blockin(&session->dsp, &session->block)) return -1;
	float **pcm = NULL;
	int frames = vorbis_synthesis_pcmout(&session->dsp, &pcm);
	if (frames < 0 || frames > (int)capacity_frames) return -1;
	for (int frame = 0; frame < frames; frame++) {
		for (uint32_t channel = 0; channel < session->channels; channel++) output[(size_t)frame * session->channels + channel] = pcm[channel][frame];
	}
	if (vorbis_synthesis_read(&session->dsp, frames)) return -1;
	return frames;
}
