/* SPDX-License-Identifier: AGPL-3.0-only */

#include "pipewire_session.h"

#include "audio_ring.h"

#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(__linux__)
#define SOUNDSCAPER_HAS_PIPEWIRE 1
#include <dlfcn.h>
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#else
#define SOUNDSCAPER_HAS_PIPEWIRE 0
#endif

#define SOUNDSCAPER_PIPEWIRE_MAX_QUANTUM 8192u
/* How long an open waits for the graph to answer the connect it queued. Past
 * this the answer is that there was none, which is a refusal and not a session. */
#define SOUNDSCAPER_PIPEWIRE_NEGOTIATION_MS 2000u
#define SOUNDSCAPER_PIPEWIRE_POLL_MS 2u

#if SOUNDSCAPER_HAS_PIPEWIRE

typedef struct {
	void *library;
	void (*init)(int *, char ***);
	void (*deinit)(void);
	struct pw_thread_loop *(*thread_loop_new)(const char *, const struct spa_dict *);
	void (*thread_loop_destroy)(struct pw_thread_loop *);
	int (*thread_loop_start)(struct pw_thread_loop *);
	void (*thread_loop_stop)(struct pw_thread_loop *);
	void (*thread_loop_lock)(struct pw_thread_loop *);
	void (*thread_loop_unlock)(struct pw_thread_loop *);
	struct pw_loop *(*thread_loop_get_loop)(struct pw_thread_loop *);
	struct pw_stream *(*stream_new_simple)(struct pw_loop *, const char *, struct pw_properties *,
		const struct pw_stream_events *, void *);
	void (*stream_destroy)(struct pw_stream *);
	int (*stream_connect)(struct pw_stream *, enum pw_direction, uint32_t, enum pw_stream_flags,
		const struct spa_pod **, uint32_t);
	struct pw_buffer *(*stream_dequeue_buffer)(struct pw_stream *);
	int (*stream_queue_buffer)(struct pw_stream *, struct pw_buffer *);
	struct pw_properties *(*properties_new)(const char *, ...);
	struct pw_context *(*context_new)(struct pw_loop *, struct pw_properties *, size_t);
	void (*context_destroy)(struct pw_context *);
	struct pw_core *(*context_connect)(struct pw_context *, struct pw_properties *, size_t);
	int (*core_disconnect)(struct pw_core *);
} pipewire_api;

static int load_pipewire(pipewire_api *api)
{
	memset(api, 0, sizeof(*api));
	api->library = dlopen("libpipewire-0.3.so.0", RTLD_LAZY | RTLD_LOCAL);
	if (api->library == NULL) api->library = dlopen("libpipewire-0.3.so", RTLD_LAZY | RTLD_LOCAL);
	if (api->library == NULL) return 0;
	#define BIND(field, symbol) \
		do { \
			*(void **)(&api->field) = dlsym(api->library, symbol); \
			if (api->field == NULL) { dlclose(api->library); api->library = NULL; return 0; } \
		} while (0)
	BIND(init, "pw_init");
	BIND(deinit, "pw_deinit");
	BIND(thread_loop_new, "pw_thread_loop_new");
	BIND(thread_loop_destroy, "pw_thread_loop_destroy");
	BIND(thread_loop_start, "pw_thread_loop_start");
	BIND(thread_loop_stop, "pw_thread_loop_stop");
	BIND(thread_loop_lock, "pw_thread_loop_lock");
	BIND(thread_loop_unlock, "pw_thread_loop_unlock");
	BIND(thread_loop_get_loop, "pw_thread_loop_get_loop");
	BIND(stream_new_simple, "pw_stream_new_simple");
	BIND(stream_destroy, "pw_stream_destroy");
	BIND(stream_connect, "pw_stream_connect");
	BIND(stream_dequeue_buffer, "pw_stream_dequeue_buffer");
	BIND(stream_queue_buffer, "pw_stream_queue_buffer");
	BIND(properties_new, "pw_properties_new");
	BIND(context_new, "pw_context_new");
	BIND(context_destroy, "pw_context_destroy");
	BIND(context_connect, "pw_context_connect");
	BIND(core_disconnect, "pw_core_disconnect");
	#undef BIND
	return 1;
}

#endif /* SOUNDSCAPER_HAS_PIPEWIRE */

struct soundscaper_pipewire_session {
#if SOUNDSCAPER_HAS_PIPEWIRE
	pipewire_api api;
	struct pw_thread_loop *loop;
	struct pw_stream *stream;
	struct spa_hook listener;
#endif
	soundscaper_sample_ring ring;
	soundscaper_device_direction direction;
	uint32_t channel_count;
	uint32_t quantum;
	atomic_uint_least64_t frames;
	atomic_uint_least64_t lost_frames;
	atomic_int lost_device;
	/* What the graph actually accepted, published by the loop thread. Until
	 * these are set the connect is a request and nothing more. */
	atomic_uint_least32_t negotiated_rate;
	atomic_uint_least32_t negotiated_channels;
	atomic_int negotiated;
	atomic_int connected;
	int closed;
};

static void set_text(char *destination, const char *source)
{
	destination[0] = '\0';
	if (source == NULL) return;
	size_t length = strlen(source);
	if (length >= SOUNDSCAPER_AUDIO_MAX_TEXT) length = SOUNDSCAPER_AUDIO_MAX_TEXT - 1u;
	memcpy(destination, source, length);
	destination[length] = '\0';
}

#if SOUNDSCAPER_HAS_PIPEWIRE

/*
 * PipeWire's realtime thread. No allocation, no locks, no syscalls: it moves
 * interleaved samples between the mapped graph buffer and the ring and returns.
 * Starvation is counted rather than concealed — the graph has already consumed
 * that quantum, so the only honest response is to record what was missed.
 */
static void on_process(void *data)
{
	soundscaper_pipewire_session *session = data;
	struct pw_buffer *buffer = session->api.stream_dequeue_buffer(session->stream);
	if (buffer == NULL) return;
	struct spa_data *datas = buffer->buffer->datas;
	float *samples = datas[0].data;
	if (samples == NULL) {
		session->api.stream_queue_buffer(session->stream, buffer);
		return;
	}
	const uint32_t stride = sizeof(float) * session->channel_count;
	if (session->direction == SOUNDSCAPER_DEVICE_OUTPUT) {
		uint32_t frames = datas[0].maxsize / stride;
		if (buffer->requested != 0u && buffer->requested < frames) frames = (uint32_t)buffer->requested;
		const uint32_t wanted = frames * session->channel_count;
		const uint32_t moved = soundscaper_ring_pop(&session->ring, samples, wanted);
		if (moved < wanted) {
			memset(samples + moved, 0, (wanted - moved) * sizeof(float));
			atomic_fetch_add_explicit(&session->lost_frames,
				(wanted - moved) / session->channel_count, memory_order_relaxed);
		}
		datas[0].chunk->offset = 0;
		datas[0].chunk->stride = (int32_t)stride;
		datas[0].chunk->size = wanted * sizeof(float);
		atomic_fetch_add_explicit(&session->frames, frames, memory_order_relaxed);
	} else {
		/* The chunk's offset and size are the server's claims about memory this
		 * process merely mapped, so the readable region is computed from the
		 * mapping rather than taken on trust. */
		uint32_t byte_offset = 0u;
		const uint32_t frames = soundscaper_graph_buffer_frames(datas[0].maxsize,
			datas[0].chunk->offset, (uint32_t)datas[0].chunk->size, stride, &byte_offset);
		const float *region = (const float *)(const void *)((const uint8_t *)datas[0].data + byte_offset);
		const uint32_t produced = frames * session->channel_count;
		const uint32_t moved = soundscaper_ring_push(&session->ring, region, produced);
		if (moved < produced) {
			atomic_fetch_add_explicit(&session->lost_frames,
				(produced - moved) / session->channel_count, memory_order_relaxed);
		}
		atomic_fetch_add_explicit(&session->frames, produced / session->channel_count, memory_order_relaxed);
	}
	session->api.stream_queue_buffer(session->stream, buffer);
}

static void on_state_changed(void *data, enum pw_stream_state old, enum pw_stream_state state, const char *error)
{
	(void)old;
	(void)error;
	soundscaper_pipewire_session *session = data;
	/* An errored or unconnected stream is device loss. It is latched rather
	 * than acted on here: this runs on the loop thread, and what to do about a
	 * lost device is the caller's decision about recorded audio. */
	if (state == PW_STREAM_STATE_ERROR || state == PW_STREAM_STATE_UNCONNECTED) {
		atomic_store_explicit(&session->lost_device, 1, memory_order_release);
		return;
	}
	if (state == PW_STREAM_STATE_PAUSED || state == PW_STREAM_STATE_STREAMING) {
		atomic_store_explicit(&session->connected, 1, memory_order_release);
	}
}

/*
 * The graph's answer to the format that was asked for. It arrives on the loop
 * thread some time after the connect returned, and it is the only thing that
 * can be reported as granted.
 */
static void on_param_changed(void *data, uint32_t id, const struct spa_pod *param)
{
	soundscaper_pipewire_session *session = data;
	if (param == NULL || id != SPA_PARAM_Format) return;
	struct spa_audio_info_raw info;
	memset(&info, 0, sizeof(info));
	if (spa_format_audio_raw_parse(param, &info) < 0) return;
	atomic_store_explicit(&session->negotiated_rate, info.rate, memory_order_relaxed);
	atomic_store_explicit(&session->negotiated_channels, info.channels, memory_order_relaxed);
	atomic_store_explicit(&session->negotiated, 1, memory_order_release);
}

static const struct pw_stream_events STREAM_EVENTS = {
	.version = PW_VERSION_STREAM_EVENTS,
	.state_changed = on_state_changed,
	.param_changed = on_param_changed,
	.process = on_process,
};

#endif /* SOUNDSCAPER_HAS_PIPEWIRE */

void soundscaper_pipewire_enumerate(soundscaper_backend_inventory *inventory)
{
	if (inventory == NULL) return;
	memset(inventory, 0, sizeof(*inventory));
#if SOUNDSCAPER_HAS_PIPEWIRE
	pipewire_api api;
	if (!load_pipewire(&api)) {
		inventory->status = SOUNDSCAPER_BACKEND_LIBRARY_ABSENT;
		set_text(inventory->detail, "libpipewire could not be loaded on this system.");
		return;
	}
	api.init(NULL, NULL);
	struct pw_thread_loop *loop = api.thread_loop_new("soundscaper-discovery", NULL);
	if (loop == NULL || api.thread_loop_start(loop) < 0) {
		if (loop != NULL) api.thread_loop_destroy(loop);
		api.deinit();
		dlclose(api.library);
		inventory->status = SOUNDSCAPER_BACKEND_SERVER_ABSENT;
		set_text(inventory->detail, "The PipeWire loop could not be started.");
		return;
	}
	/*
	 * Starting a loop proves nothing: it succeeds with no server anywhere. The
	 * only honest liveness check is connecting a core, so discovery does that
	 * and disconnects again. It never starts a server the user did not ask for.
	 */
	api.thread_loop_lock(loop);
	struct pw_context *context = api.context_new(api.thread_loop_get_loop(loop), NULL, 0u);
	struct pw_core *core = context == NULL ? NULL : api.context_connect(context, NULL, 0u);
	const int connected = core != NULL;
	if (core != NULL) api.core_disconnect(core);
	if (context != NULL) api.context_destroy(context);
	api.thread_loop_unlock(loop);
	api.thread_loop_stop(loop);
	api.thread_loop_destroy(loop);
	api.deinit();
	dlclose(api.library);
	if (!connected) {
		inventory->status = SOUNDSCAPER_BACKEND_SERVER_ABSENT;
		set_text(inventory->detail, "No PipeWire server is running; discovery does not start one.");
		return;
	}
	/*
	 * The session manager owns device naming, and asking the registry for it is
	 * a second async round trip. The default sink and source are the two the
	 * user has actually chosen, so they are published by their well-known names
	 * and the rest is left to the session manager rather than duplicated here.
	 */
	inventory->status = SOUNDSCAPER_BACKEND_AVAILABLE;
	inventory->device_count = 2u;
	set_text(inventory->devices[0].handle, "@DEFAULT_SINK@");
	set_text(inventory->devices[0].label, "Default output (PipeWire)");
	inventory->devices[0].direction = SOUNDSCAPER_DEVICE_OUTPUT;
	set_text(inventory->devices[1].handle, "@DEFAULT_SOURCE@");
	set_text(inventory->devices[1].label, "Default input (PipeWire)");
	inventory->devices[1].direction = SOUNDSCAPER_DEVICE_INPUT;
#else
	inventory->status = SOUNDSCAPER_BACKEND_UNSUPPORTED_PLATFORM;
	set_text(inventory->detail, "This target does not implement the PipeWire backend.");
#endif
}

soundscaper_audio_open_status soundscaper_pipewire_open(
	const char *device_handle,
	soundscaper_device_direction direction,
	uint32_t exclusive_requested,
	uint32_t sample_rate,
	uint32_t period_frames,
	uint32_t channel_count,
	soundscaper_pipewire_session **out_session,
	soundscaper_audio_granted *granted)
{
	if (out_session == NULL || granted == NULL) return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	*out_session = NULL;
	memset(granted, 0, sizeof(*granted));
	if (device_handle == NULL || device_handle[0] == '\0'
		|| channel_count == 0u || channel_count > SOUNDSCAPER_AUDIO_MAX_CHANNELS
		|| period_frames == 0u || period_frames > SOUNDSCAPER_PIPEWIRE_MAX_QUANTUM
		|| sample_rate < 8000u || sample_rate > 768000u
		|| direction == SOUNDSCAPER_DEVICE_DUPLEX) {
		set_text(granted->detail, "The open request is outside the admitted bounds, or asks for duplex.");
		return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	}
#if SOUNDSCAPER_HAS_PIPEWIRE
	soundscaper_pipewire_session *session = calloc(1u, sizeof(*session));
	if (session == NULL) return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	if (!load_pipewire(&session->api)) {
		free(session);
		set_text(granted->detail, "libpipewire could not be loaded on this system.");
		return SOUNDSCAPER_AUDIO_OPEN_BACKEND_UNAVAILABLE;
	}
	session->direction = direction;
	session->channel_count = channel_count;
	session->quantum = period_frames;
	atomic_init(&session->frames, 0u);
	atomic_init(&session->lost_frames, 0u);
	atomic_init(&session->lost_device, 0);
	atomic_init(&session->negotiated_rate, 0u);
	atomic_init(&session->negotiated_channels, 0u);
	atomic_init(&session->negotiated, 0);
	atomic_init(&session->connected, 0);
	if (!soundscaper_ring_init(&session->ring, period_frames, channel_count)) {
		dlclose(session->api.library);
		free(session);
		return SOUNDSCAPER_AUDIO_OPEN_INVALID_REQUEST;
	}

	session->api.init(NULL, NULL);
	session->loop = session->api.thread_loop_new("soundscaper-audio", NULL);
	if (session->loop == NULL) {
		soundscaper_pipewire_close(session);
		set_text(granted->detail, "No PipeWire server is running.");
		return SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE;
	}
	char latency[64];
	snprintf(latency, sizeof(latency), "%u/%u", period_frames, sample_rate);
	struct pw_properties *properties = session->api.properties_new(
		PW_KEY_MEDIA_TYPE, "Audio",
		PW_KEY_MEDIA_CATEGORY, direction == SOUNDSCAPER_DEVICE_OUTPUT ? "Playback" : "Capture",
		PW_KEY_MEDIA_ROLE, "Production",
		PW_KEY_NODE_NAME, "Soundscaper",
		PW_KEY_NODE_LATENCY, latency,
		PW_KEY_TARGET_OBJECT, device_handle,
		NULL);
	session->stream = session->api.stream_new_simple(
		session->api.thread_loop_get_loop(session->loop), "Soundscaper", properties, &STREAM_EVENTS, session);
	if (session->stream == NULL) {
		soundscaper_pipewire_close(session);
		set_text(granted->detail, "The PipeWire stream could not be created.");
		return SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE;
	}

	uint8_t pod_buffer[1024];
	struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(pod_buffer, sizeof(pod_buffer));
	struct spa_audio_info_raw info = {
		.format = SPA_AUDIO_FORMAT_F32,
		.rate = sample_rate,
		.channels = channel_count,
	};
	const struct spa_pod *params[1] = {
		spa_format_audio_raw_build(&builder, SPA_PARAM_EnumFormat, &info),
	};
	/* NO_CONVERT is what makes exclusive mean something: without it PipeWire
	 * will happily resample and remix to satisfy the request, which is the
	 * silent substitution the milestone stops on. */
	enum pw_stream_flags flags = PW_STREAM_FLAG_AUTOCONNECT
		| PW_STREAM_FLAG_MAP_BUFFERS
		| PW_STREAM_FLAG_RT_PROCESS;
	if (exclusive_requested) flags |= PW_STREAM_FLAG_EXCLUSIVE | PW_STREAM_FLAG_NO_CONVERT;
	const int connected = session->api.stream_connect(
		session->stream,
		direction == SOUNDSCAPER_DEVICE_OUTPUT ? PW_DIRECTION_OUTPUT : PW_DIRECTION_INPUT,
		PW_ID_ANY, flags, params, 1u);
	if (connected < 0) {
		soundscaper_pipewire_close(session);
		set_text(granted->detail, exclusive_requested
			? "PipeWire refused exclusive access to that node."
			: "PipeWire refused the requested audio format.");
		return exclusive_requested ? SOUNDSCAPER_AUDIO_OPEN_MODE_REFUSED : SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED;
	}
	if (session->api.thread_loop_start(session->loop) < 0) {
		soundscaper_pipewire_close(session);
		set_text(granted->detail, "The PipeWire loop could not be started.");
		return SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE;
	}
	/* `pw_stream_connect` only queues the request: whether a node exists, and
	 * what format it took, arrives later on the loop thread. Reporting the
	 * request as the outcome here is what turns a refusal into a session that
	 * fails much later as device loss, with the backup candidate never tried. */
	for (uint32_t waited = 0u; waited < SOUNDSCAPER_PIPEWIRE_NEGOTIATION_MS;
		waited += SOUNDSCAPER_PIPEWIRE_POLL_MS) {
		if (atomic_load_explicit(&session->lost_device, memory_order_acquire)) break;
		if (atomic_load_explicit(&session->negotiated, memory_order_acquire)
			&& atomic_load_explicit(&session->connected, memory_order_acquire)) {
			break;
		}
		struct timespec request = { .tv_sec = 0, .tv_nsec = SOUNDSCAPER_PIPEWIRE_POLL_MS * 1000000L };
		nanosleep(&request, NULL);
	}
	if (atomic_load_explicit(&session->lost_device, memory_order_acquire)) {
		soundscaper_pipewire_close(session);
		set_text(granted->detail, "The PipeWire node failed while the stream was being negotiated.");
		return SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE;
	}
	if (!atomic_load_explicit(&session->negotiated, memory_order_acquire)
		|| !atomic_load_explicit(&session->connected, memory_order_acquire)) {
		soundscaper_pipewire_close(session);
		set_text(granted->detail, "The PipeWire graph did not finish negotiating this stream.");
		return SOUNDSCAPER_AUDIO_OPEN_DEVICE_UNAVAILABLE;
	}
	const uint32_t negotiated_rate = (uint32_t)atomic_load_explicit(&session->negotiated_rate, memory_order_relaxed);
	const uint32_t negotiated_channels =
		(uint32_t)atomic_load_explicit(&session->negotiated_channels, memory_order_relaxed);
	if (negotiated_rate != sample_rate || negotiated_channels != channel_count) {
		char detail[SOUNDSCAPER_AUDIO_MAX_TEXT];
		snprintf(detail, sizeof(detail),
			"The graph negotiated %u Hz across %u channel(s), not the requested %u Hz across %u.",
			negotiated_rate, negotiated_channels, sample_rate, channel_count);
		soundscaper_pipewire_close(session);
		set_text(granted->detail, detail);
		return SOUNDSCAPER_AUDIO_OPEN_FORMAT_REFUSED;
	}
	granted->sample_rate = negotiated_rate;
	granted->period_frames = period_frames;
	granted->channel_count = negotiated_channels;
	/* NO_CONVERT accompanies an exclusive request, so a format that came back
	 * unchanged is the graph saying it put nothing in the path. */
	granted->exclusive = exclusive_requested ? 1u : 0u;
	set_text(granted->device_name, device_handle);
	/* The quantum is a request until the graph runs. Callers that need the
	 * granted value read it back from the session after the first block. */
	set_text(granted->detail, "The quantum is negotiated by the graph; the granted value is observed, not assumed.");
	*out_session = session;
	return SOUNDSCAPER_AUDIO_OPEN_OK;
#else
	(void)exclusive_requested;
	set_text(granted->detail, "This target does not implement the PipeWire backend.");
	return SOUNDSCAPER_AUDIO_OPEN_NOT_IMPLEMENTED;
#endif
}

void soundscaper_pipewire_close(soundscaper_pipewire_session *session)
{
	if (session == NULL || session->closed) return;
	session->closed = 1;
#if SOUNDSCAPER_HAS_PIPEWIRE
	/* Stop the loop before destroying the stream: the realtime callback holds
	 * the ring, and tearing that out from under it is a use-after-free. */
	if (session->loop != NULL) session->api.thread_loop_stop(session->loop);
	if (session->stream != NULL) session->api.stream_destroy(session->stream);
	if (session->loop != NULL) session->api.thread_loop_destroy(session->loop);
	if (session->api.library != NULL) {
		session->api.deinit();
		dlclose(session->api.library);
	}
#endif
	soundscaper_ring_release(&session->ring);
	free(session);
}

static soundscaper_audio_io_status transfer_status(
	soundscaper_pipewire_session *session,
	uint32_t wanted,
	uint32_t moved,
	uint64_t *out_lost_frames)
{
	if (atomic_load_explicit(&session->lost_device, memory_order_acquire)) {
		return SOUNDSCAPER_AUDIO_IO_DEVICE_LOST;
	}
	if (moved < wanted) {
		const uint64_t lost = (wanted - moved) / session->channel_count;
		if (out_lost_frames != NULL) *out_lost_frames = lost;
		return SOUNDSCAPER_AUDIO_IO_RECOVERED;
	}
	return SOUNDSCAPER_AUDIO_IO_OK;
}

soundscaper_audio_io_status soundscaper_pipewire_write(
	soundscaper_pipewire_session *session,
	const float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (out_lost_frames != NULL) *out_lost_frames = 0u;
	if (session == NULL || session->closed) return SOUNDSCAPER_AUDIO_IO_CLOSED;
	if (session->direction != SOUNDSCAPER_DEVICE_OUTPUT) return SOUNDSCAPER_AUDIO_IO_WRONG_DIRECTION;
	if (channels == NULL || frame_count == 0u || frame_count > SOUNDSCAPER_PIPEWIRE_MAX_QUANTUM) {
		return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
	}
	const uint32_t wanted = frame_count * session->channel_count;
	uint32_t moved = 0u;
	for (uint32_t frame = 0u; frame < frame_count; frame += 1u) {
		float interleaved[SOUNDSCAPER_AUDIO_MAX_CHANNELS];
		for (uint32_t channel = 0u; channel < session->channel_count; channel += 1u) {
			if (channels[channel] == NULL) return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
			interleaved[channel] = channels[channel][frame];
		}
		const uint32_t pushed = soundscaper_ring_push(&session->ring, interleaved, session->channel_count);
		moved += pushed;
		if (pushed < session->channel_count) break;
	}
	return transfer_status(session, wanted, moved, out_lost_frames);
}

soundscaper_audio_io_status soundscaper_pipewire_read(
	soundscaper_pipewire_session *session,
	float *const *channels,
	uint32_t frame_count,
	uint64_t *out_lost_frames)
{
	if (out_lost_frames != NULL) *out_lost_frames = 0u;
	if (session == NULL || session->closed) return SOUNDSCAPER_AUDIO_IO_CLOSED;
	if (session->direction != SOUNDSCAPER_DEVICE_INPUT) return SOUNDSCAPER_AUDIO_IO_WRONG_DIRECTION;
	if (channels == NULL || frame_count == 0u || frame_count > SOUNDSCAPER_PIPEWIRE_MAX_QUANTUM) {
		return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
	}
	const uint32_t wanted = frame_count * session->channel_count;
	uint32_t moved = 0u;
	for (uint32_t frame = 0u; frame < frame_count; frame += 1u) {
		float interleaved[SOUNDSCAPER_AUDIO_MAX_CHANNELS];
		const uint32_t popped = soundscaper_ring_pop(&session->ring, interleaved, session->channel_count);
		if (popped < session->channel_count) break;
		for (uint32_t channel = 0u; channel < session->channel_count; channel += 1u) {
			if (channels[channel] == NULL) return SOUNDSCAPER_AUDIO_IO_INVALID_BLOCK;
			/* Frames the graph never delivered are left untouched rather than
			 * zero-filled: fabricated silence is indistinguishable from
			 * recorded silence, and the caller is given the count instead. */
			channels[channel][frame] = interleaved[channel];
		}
		moved += popped;
	}
	return transfer_status(session, wanted, moved, out_lost_frames);
}

uint64_t soundscaper_pipewire_frames(const soundscaper_pipewire_session *session)
{
	return session == NULL ? 0u : atomic_load_explicit(&session->frames, memory_order_relaxed);
}

uint64_t soundscaper_pipewire_lost_frames(const soundscaper_pipewire_session *session)
{
	return session == NULL ? 0u : atomic_load_explicit(&session->lost_frames, memory_order_relaxed);
}
