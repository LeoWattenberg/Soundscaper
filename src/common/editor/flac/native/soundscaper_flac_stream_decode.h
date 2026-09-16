/* SPDX-License-Identifier: AGPL-3.0-only */

typedef struct { unsigned char streaminfo[34]; uint32_t rate; uint32_t channels; } ScflStreamDecode;

void *scfl_stream_decode_open(const unsigned char *description, uint32_t length, uint32_t rate, uint32_t channels) {
	if (!description || length != 42 || memcmp(description, "fLaC", 4) || rate < 8000 || rate > 192000 || channels < 1 || channels > 8) return NULL;
	ScflStreamDecode *session = calloc(1, sizeof(*session));
	if (!session) return NULL;
	memcpy(session->streaminfo, description + 8, 34);
	session->rate = rate;
	session->channels = channels;
	return session;
}

int scfl_stream_decode_push(void *handle, const unsigned char *input, uint32_t length, float *output, uint32_t capacity_frames) {
	ScflStreamDecode *session = handle;
	if (!session || !input || length < 1 || length > 1048576 || !output || capacity_frames < 1 || capacity_frames > 65536) return -1;
	unsigned char *stream = malloc((size_t)length + 42);
	if (!stream) return -1;
	memcpy(stream, "fLaC\200\000\000\042", 8);
	memcpy(stream + 8, session->streaminfo, 34);
	/* Independent FLAC frames retain their CRC; unknown total/MD5 permits this bounded packet stream. */
	stream[21] &= 0xf0;
	memset(stream + 22, 0, 20);
	memcpy(stream + 42, input, length);
	FLAC__StreamDecoder *decoder = FLAC__stream_decoder_new();
	DecodeContext context = { stream, length + 42, 0, output, 0, capacity_frames, session->channels, session->rate, 0, 0, 0 };
	int result = -1;
	if (decoder && FLAC__stream_decoder_init_stream(decoder, decode_read, NULL, NULL, NULL, NULL,
		decode_write, decode_metadata, decode_error, &context) == FLAC__STREAM_DECODER_INIT_STATUS_OK
		&& FLAC__stream_decoder_process_until_end_of_stream(decoder)
		&& !context.failed && context.metadata_seen && context.output_frames > 0) result = (int)context.output_frames;
	if (decoder) { FLAC__stream_decoder_finish(decoder); FLAC__stream_decoder_delete(decoder); }
	free(stream);
	return result;
}

void scfl_stream_decode_close(void *handle) { free(handle); }
