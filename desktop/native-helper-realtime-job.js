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

const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

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

/**
 * Declares the generation on the wire the receiver reads. It is a different
 * message from the handshake main takes: main is told what the port it forwards
 * carries, while the far end is told the shape to size its queue around and
 * queues nothing at all until it has been told.
 */
export function realtimeOpenMessage({ generation, format, startFrame = 0 }) {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
		kind: 'open',
		generation,
		startFrame,
		channelCount: format.channelCount,
		frameCount: format.frameCount,
		queueCapacity: format.queueCapacity,
	};
}

/**
 * Every sample buffer a generation will ever use, allocated when it opens. A
 * buffer coming home is the only credit for another send, so a helper that has
 * outrun the far end has nothing to send rather than a deeper queue to fill.
 */
function createPacketPool({ channelCount, frameCount, queueCapacity }) {
	const slots = [];
	const free = [];
	for (let packetId = 0; packetId < queueCapacity; packetId += 1) {
		slots.push({
			packetId,
			channels: Array.from({ length: channelCount }, () => new Float32Array(frameCount)),
			sequence: -1,
		});
		free.push(packetId);
	}
	return {
		get availableCount() { return free.length; },
		acquire(sequence) {
			const packetId = free.pop();
			if (packetId === undefined) return null;
			const slot = slots[packetId];
			slot.sequence = sequence;
			return slot;
		},
		release(dispatch) {
			if (!Number.isSafeInteger(dispatch.packetId)) return false;
			const slot = slots[dispatch.packetId];
			// A return has to name the dispatch it acknowledges: crediting a
			// duplicate would hand memory that is legitimately in flight to a
			// second writer.
			if (!slot || slot.sequence < 0 || slot.sequence !== dispatch.sequence) return false;
			const adopted = adoptReturnedChannels(dispatch.channels, channelCount, frameCount);
			if (adopted === null) return false;
			slot.channels = adopted;
			slot.sequence = -1;
			free.push(slot.packetId);
			return true;
		},
	};
}

/**
 * Re-adopts the memory the far end handed back. Transfer destroys identity, so
 * the pool can only insist on its own shape: one whole buffer per channel, and
 * never two channels over one buffer, which would cost it a buffer for good and
 * leave the survivors aliased.
 */
function adoptReturnedChannels(channels, channelCount, frameCount) {
	if (!Array.isArray(channels) || channels.length !== channelCount) return null;
	const bytes = frameCount * BYTES_PER_SAMPLE;
	const adopted = [];
	for (const channel of channels) {
		if (!(channel instanceof Float32Array) || !(channel.buffer instanceof ArrayBuffer)) return null;
		if (channel.buffer.byteLength !== bytes) return null;
		if (adopted.some((seen) => seen.buffer === channel.buffer)) return null;
		adopted.push(channel.byteOffset === 0 && channel.length === frameCount ? channel : new Float32Array(channel.buffer));
	}
	return adopted;
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
		closing.port.onmessage = null;
		try {
			closing.port.close();
		} catch {
			/* A peer that already went away needs no closing. */
		}
		return Object.freeze({ generation: closing.generation, reason, frames: closing.frames });
	}

	/**
	 * The far end hands a packet's memory back over the same port, so the end the
	 * helper kept has to be read: buffers left unread in that queue are the credit
	 * the generation is waiting for, and the stream would die of queue growth
	 * rather than of the backpressure this plane exists to measure.
	 */
	function acceptPeerMessage(generation, data) {
		if (active === null || active.generation !== generation) return;
		if (data?.kind === 'close') {
			close(typeof data.reason === 'string' ? data.reason : 'peer-loss');
			return;
		}
		if (data?.kind !== 'return') return;
		// A return the ledger cannot account for means a buffer is either lost or
		// duplicated, and neither is recoverable inside a real-time generation.
		if (!active.pool.release(data)) close('pool-leak');
	}

	return Object.freeze({
		get generation() { return active?.generation ?? null; },

		/** Buffers this generation still owns, which is what it may still send. */
		get credit() { return active?.pool.availableCount ?? 0; },

		/**
		 * Opens one generation and hands its port to main. The previous
		 * generation is closed first and exactly once: two live generations over
		 * one device is the state that produces two writers on one buffer.
		 */
		open({ generation, format, startFrame = 0 }) {
			close('superseded');
			const channel = createChannel();
			const engine = createEngine({ format, generation });
			active = {
				generation,
				format,
				engine,
				port: channel.port1,
				pool: createPacketPool(format),
				frames: startFrame,
				sequence: 0,
				startedAt: now(),
			};
			// Listening before anything can be answered, because the first return
			// may arrive as soon as the far end has drained the first packet.
			channel.port1.onmessage = (event) => acceptPeerMessage(generation, event?.data);
			channel.port1.start?.();
			channel.port1.postMessage(realtimeOpenMessage({ generation, format, startFrame }));
			// The port is transferred, not copied: after this call the helper's
			// own reference to port2 is detached, which is what makes "main is
			// not in the per-block path" a structural fact rather than a promise.
			post(realtimeHandshake({ generation, format, startFrame }), [channel.port2]);
			return Object.freeze({ generation, startFrame });
		},

		/**
		 * Produces one packet. Returns null once the generation is over, and also
		 * while every buffer is still out: a pool that grew under pressure would
		 * hide the starvation rather than report it.
		 */
		pump() {
			if (active === null) return null;
			const { format } = active;
			const slot = active.pool.acquire(active.sequence);
			if (slot === null) return null;
			const channels = slot.channels;
			active.engine.render(active.frames, format.frameCount, channels);
			const packet = {
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
				kind: 'audio',
				generation: active.generation,
				// Sequence counts this generation's packets rather than the
				// timeline's frames: the far end expects zero after every open,
				// wherever the transport was asked to start.
				sequence: active.sequence,
				startFrame: active.frames,
				frameCount: format.frameCount,
				packetId: slot.packetId,
				channels,
			};
			active.sequence += 1;
			active.frames += format.frameCount;
			active.port.postMessage(packet, channels.map((plane) => plane.buffer));
			return packet;
		},

		close,
	});
}
