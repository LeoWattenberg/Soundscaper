/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The helper end of the real-time data plane.
 *
 * The helper owns the channel. It creates the `MessageChannel`, keeps one end,
 * and posts the other to main as a transfer — so main can revoke the stream but
 * never sits in the per-block path. Once the worklet holds that port, audio goes
 * helper → worklet directly and nothing about a block passes through either
 * main or the renderer's main thread.
 *
 * Everything here is generation-scoped. A stream that main has withdrawn stops
 * producing immediately rather than finishing its buffer, because a packet from
 * a withdrawn generation is stale audio and the transport's whole contract is
 * that stale audio is dropped rather than played.
 */

/*
 * Deliberately duplicated rather than imported. Reaching the editor's protocol
 * module from here would drag its whole transitive tree into the packaged
 * desktop runtime for the sake of one integer; a test pins this constant to
 * that one so the duplication cannot drift.
 */
export const NATIVE_REALTIME_PROTOCOL_VERSION = 1;

export const REALTIME_SAMPLE_FORMAT = 'f32-planar';

/**
 * Builds the handshake main validates before the port moves. The key set is
 * exact: main re-validates it against the same closed schema, so an extra field
 * here is a refusal rather than something quietly ignored.
 */
export function realtimeHandshake({ generation, format, startFrame = 0 }) {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
		generation,
		startFrame,
		sampleFormat: REALTIME_SAMPLE_FORMAT,
		sampleRate: format.sampleRate,
		channelCount: format.channelCount,
		frameCount: format.frameCount,
		queueCapacity: format.queueCapacity,
	};
}

export function createNativeRealtimeStreamer({ post, createChannel, createEngine, now = () => Date.now() }) {
	if (typeof post !== 'function') throw new TypeError('A helper post seam is required.');
	if (typeof createChannel !== 'function') throw new TypeError('A MessageChannel factory is required.');
	if (typeof createEngine !== 'function') throw new TypeError('A realtime engine factory is required.');
	let active = null;

	function close(reason) {
		if (active === null) return null;
		const closing = active;
		active = null;
		try {
			closing.port.close();
		} catch {
			/* A peer that already went away needs no closing. */
		}
		return Object.freeze({ generation: closing.generation, reason, frames: closing.frames });
	}

	return Object.freeze({
		get generation() { return active?.generation ?? null; },

		/**
		 * Opens one generation and hands its port to main. The previous
		 * generation is closed first and exactly once: two live generations over
		 * one device is the state that produces two writers on one buffer.
		 */
		open({ generation, format, startFrame = 0 }) {
			close('superseded');
			const channel = createChannel();
			const engine = createEngine({ format, generation });
			active = { generation, format, port: channel.port1, engine, frames: startFrame, startedAt: now() };
			// The port is transferred, not copied: after this call the helper's
			// own reference to port2 is detached, which is what makes "main is
			// not in the per-block path" a structural fact rather than a promise.
			post(realtimeHandshake({ generation, format, startFrame }), [channel.port2]);
			return Object.freeze({ generation, startFrame });
		},

		/** Produces one packet. Returns null once the generation is over. */
		pump() {
			if (active === null) return null;
			const { format } = active;
			const channels = Array.from({ length: format.channelCount }, () => new Float32Array(format.frameCount));
			active.engine.render(active.frames, format.frameCount, channels);
			const packet = {
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
				kind: 'audio',
				generation: active.generation,
				sequence: (active.frames - 0) / format.frameCount,
				startFrame: active.frames,
				frameCount: format.frameCount,
				packetId: ((active.frames / format.frameCount) % format.queueCapacity) | 0,
				channels,
			};
			active.frames += format.frameCount;
			active.port.postMessage(packet, channels.map((plane) => plane.buffer));
			return packet;
		},

		close,
	});
}
