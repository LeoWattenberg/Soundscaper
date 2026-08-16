/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
} from './chunk-stream.js';
import {
	NATIVE_REALTIME_CLOSE_REASONS,
	NATIVE_REALTIME_MAX_GENERATION,
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PROTOCOL_VERSION,
	createNativeRealtimeReceiver,
} from './native-realtime-transport.ts';
import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {
	constructor() {
		this.port = { postMessage() {}, onmessage: null, start() {} };
	}
};

export const NATIVE_REALTIME_WORKLET_NAME = 'kw-native-realtime-transport';

/**
 * `native-realtime-transport.ts` owns the helper <-> worklet wire. What it does
 * not own is the renderer-main <-> worklet control plane, because that half
 * never carries audio: main hands a port across, authorizes exactly one
 * generation on it, takes it away again, and is told what happened. Those names
 * live here so the two planes cannot be confused for one another.
 */
export const NATIVE_REALTIME_CONTROL = Object.freeze({
	attach: 'native-realtime-attach',
	revoke: 'native-realtime-revoke',
	peerLost: 'native-realtime-peer-lost',
	ready: 'native-realtime-ready',
	attached: 'native-realtime-attached',
	rejected: 'native-realtime-rejected',
	opened: 'native-realtime-opened',
	primed: 'native-realtime-primed',
	discarded: 'native-realtime-discarded',
	underrun: 'native-realtime-underrun',
	closed: 'native-realtime-closed',
});

/** Revocation is a cancellation; it is never a fault of the helper's. */
export const NATIVE_REALTIME_REVOKE_REASON = 'cancelled';

const CLOSE_REASONS = new Set(NATIVE_REALTIME_CLOSE_REASONS);

/**
 * Plays audio the supervised native helper sends straight down a transferred
 * MessagePort. Renderer main is in the setup and revocation path only; no
 * packet passes through it, which is the property milestone 5A-0c exists to
 * prove.
 *
 * The processor keeps two things the transport receiver deliberately leaves to
 * its host. The first is the deadline: the AudioWorklet clock decides when a
 * packet was due, so a quantum that cannot be filled is an underrun rather than
 * a reason to wait, and the generation ends there instead of playing late.
 * The second is the copy: samples move into the render quantum through a plain
 * loop, because `set(subarray(...))` would allocate a view per channel per
 * quantum on the audio thread.
 */
export class NativeRealtimeTransportProcessor extends ProcessorBase {
	constructor(options = {}) {
		super();
		const settings = options.processorOptions || {};
		this.controlPort = settings.messagePort || this.port;
		this.channelCount = boundedInteger(
			settings.channelCount ?? 2,
			1,
			PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels,
			2,
		);
		this.frameCount = boundedInteger(
			settings.packetFrames ?? AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			1,
			PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames,
			AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		);
		this.queueCapacity = boundedInteger(
			settings.maxQueuePackets ?? AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
			1,
			NATIVE_REALTIME_MAX_QUEUE_PACKETS,
			AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
		);
		this.prebufferPackets = boundedInteger(settings.prebufferPackets ?? 2, 1, this.queueCapacity, 2);

		// One receiver for the processor's whole life, so its generation ledger
		// spans port swaps: a number that has already been used cannot be
		// replayed onto a fresh port to resurrect a retired stream.
		this.receiver = createNativeRealtimeReceiver({
			channelCount: this.channelCount,
			frameCount: this.frameCount,
			queueCapacity: this.queueCapacity,
			onClose: (event) => this.#generationClosed(event),
		});
		this.helperPort = null;
		this.authorizedGeneration = -1;
		this.running = false;
		this.playhead = 0;
		this.current = null;
		this.currentChannels = null;
		this.currentOffset = 0;
		this.consumedPackets = 0;
		this.releasedBuffers = 0;

		this.controlPort.onmessage = (event) => this.#handleControl(event?.data || {}, event?.ports || []);
		this.controlPort.start?.();
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.ready,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			channelCount: this.channelCount,
			frameCount: this.frameCount,
			queueCapacity: this.queueCapacity,
		});
	}

	process(_inputs, outputs) {
		const output = outputs[0] || [];
		const blockFrames = output[0]?.length || 0;
		for (const channel of output) channel.fill(0);
		if (!blockFrames || !this.running) return true;

		let written = 0;
		// Releasing a packet can end the generation mid-quantum, and the frames
		// after that belong to no generation at all: they stay silent rather than
		// draining what the closed stream left queued behind it.
		while (this.running && written < blockFrames) {
			if (!this.current) {
				this.current = this.receiver.consume();
				this.currentChannels = this.current?.channels || null;
				this.currentOffset = 0;
			}
			if (!this.current) {
				this.#underrun(blockFrames - written);
				return true;
			}
			const frames = Math.min(blockFrames - written, this.current.frameCount - this.currentOffset);
			const channels = this.currentChannels;
			const lastChannel = channels.length - 1;
			for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
				const source = channels[channelIndex < lastChannel ? channelIndex : lastChannel];
				const target = output[channelIndex];
				for (let frame = 0; frame < frames; frame += 1) {
					target[written + frame] = source[this.currentOffset + frame];
				}
			}
			this.currentOffset += frames;
			this.playhead += frames;
			written += frames;
			if (this.currentOffset >= this.current.frameCount) this.#release();
		}
		return true;
	}

	#handleControl(message, ports) {
		if (message.type === NATIVE_REALTIME_CONTROL.attach) this.#attach(message, ports);
		else if (message.type === NATIVE_REALTIME_CONTROL.revoke) this.#revoke(message);
		else if (message.type === NATIVE_REALTIME_CONTROL.peerLost) this.#peerLost(message);
	}

	#attach(message, ports) {
		const port = ports[0] || null;
		const generation = safeInteger(message.generation);
		const acceptable = port
			&& typeof port.postMessage === 'function'
			&& Number(message.protocolVersion) === NATIVE_REALTIME_PROTOCOL_VERSION
			&& generation > this.authorizedGeneration
			&& generation <= NATIVE_REALTIME_MAX_GENERATION;
		if (!acceptable) {
			// A rejected attach never becomes a generation, so the running one
			// keeps the output; only the offered port is discarded.
			closePort(port);
			this.#postControl({
				type: NATIVE_REALTIME_CONTROL.rejected,
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
				generation: Math.max(0, generation),
				reason: 'protocol-violation',
			});
			return;
		}

		this.#closeGeneration(NATIVE_REALTIME_REVOKE_REASON);
		this.authorizedGeneration = generation;
		this.consumedPackets = 0;
		this.releasedBuffers = 0;
		this.helperPort = port;
		port.onmessage = (event) => this.#handlePeerMessage(event?.data);
		port.onmessageerror = () => this.#closeGeneration('protocol-violation');
		// A dead helper takes its port with it. This is the only loss signal
		// that does not depend on main noticing the exit first.
		listenForClose(port, () => this.#closeGeneration('peer-loss'));
		port.start?.();
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.attached,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation,
			channelCount: this.channelCount,
			frameCount: this.frameCount,
			queueCapacity: this.queueCapacity,
		});
	}

	#revoke(message) {
		if (message.generation != null && safeInteger(message.generation) !== this.authorizedGeneration) return;
		this.#closeGeneration(normalizeCloseReason(message.reason));
	}

	#peerLost(message) {
		if (message.generation != null && safeInteger(message.generation) !== this.authorizedGeneration) return;
		this.#closeGeneration('peer-loss');
	}

	#handlePeerMessage(data) {
		// Main authorizes one generation per port. A helper that mints its own
		// numbers could otherwise burn the monotonic ledger far ahead of main
		// and lock every later stream out.
		if (data?.kind === 'open' && safeInteger(data.generation) !== this.authorizedGeneration) {
			this.#postDiscard(data, 'unauthorized-generation');
			return;
		}
		const result = this.receiver.accept(data);
		if (result.status === 'opened') this.#opened(result);
		else if (result.status === 'queued') this.#queued(result);
		// 'ignored' is surfaced too: a helper still sending into a generation
		// that has already closed is exactly what main needs to see.
		else if (result.status === 'discarded' || result.status === 'ignored') {
			this.#postDiscard(data, result.detail);
		} else if (result.status === 'closed') {
			// A peer that closed the generation itself needs no echo of it.
			const echo = data?.kind === 'close' ? null : closeMessage(this.receiver.generation, result.reason);
			this.#detachHelper(echo, result.reason);
		}
	}

	#opened(result) {
		this.running = false;
		this.current = null;
		this.currentChannels = null;
		this.currentOffset = 0;
		this.consumedPackets = 0;
		this.releasedBuffers = 0;
		this.playhead = this.receiver.nextExpectedFrame ?? 0;
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.opened,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation: result.generation,
			startFrame: this.playhead,
		});
	}

	#queued(result) {
		const queuedPackets = this.receiver.queuedPackets;
		if (this.running || queuedPackets < this.prebufferPackets) return;
		this.running = true;
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.primed,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation: result.generation,
			startFrame: this.playhead,
			queuedPackets,
		});
	}

	#release() {
		const packet = this.current;
		this.current = null;
		this.currentChannels = null;
		this.currentOffset = 0;
		this.consumedPackets += 1;
		try {
			// Handing the buffers back is the sender's only credit, so release
			// is not a courtesy that can be deferred past the quantum.
			const returned = this.receiver.returnPacket(packet);
			this.helperPort?.postMessage(returned.message, returned.transfer);
			// Counted only once the buffers have left. Credit that never reached
			// the peer is the leak below, and the ledger main reads to find a
			// lost buffer must not be the thing that hides it.
			this.releasedBuffers += returned.transfer.length;
		} catch {
			this.#closeGeneration('pool-leak');
		}
	}

	#underrun(frames) {
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.underrun,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation: this.receiver.generation ?? 0,
			startFrame: this.playhead,
			frameCount: frames,
		});
		this.#detachHelper(this.receiver.reportUnderrun(), 'underrun');
	}

	#closeGeneration(reason) {
		this.#detachHelper(this.receiver.close(reason), reason);
	}

	/**
	 * Tells a live peer why it is finished, then drops the port. Keeping the
	 * port would let the helper open its next generation unsupervised; main
	 * authorizes every generation, so every generation costs a fresh attach.
	 */
	#detachHelper(message, reason) {
		const port = this.helperPort;
		this.helperPort = null;
		if (!port) return;
		port.onmessage = null;
		port.onmessageerror = null;
		if (message && reason !== 'peer-loss') safePost(port, message);
		closePort(port);
	}

	#generationClosed(event) {
		this.running = false;
		this.current = null;
		this.currentChannels = null;
		this.currentOffset = 0;
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.closed,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation: event.generation,
			reason: event.reason,
			startFrame: this.playhead,
			consumedPackets: this.consumedPackets,
			releasedBuffers: this.releasedBuffers,
		});
	}

	#postDiscard(data, reason) {
		this.#postControl({
			type: NATIVE_REALTIME_CONTROL.discarded,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation: safeInteger(data?.generation),
			sequence: safeInteger(data?.sequence),
			reason: String(reason),
		});
	}

	#postControl(message) {
		safePost(this.controlPort, message);
	}
}

if (typeof globalThis.registerProcessor === 'function') {
	globalThis.registerProcessor(NATIVE_REALTIME_WORKLET_NAME, NativeRealtimeTransportProcessor);
}

/** Control-plane reasons are closed; anything unrecognized is a cancellation. */
export function normalizeCloseReason(value) {
	return CLOSE_REASONS.has(value) ? value : NATIVE_REALTIME_REVOKE_REASON;
}

function closeMessage(generation, reason) {
	return {
		protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
		kind: 'close',
		generation: Math.max(0, safeInteger(generation)),
		reason,
	};
}

function listenForClose(port, listener) {
	if (typeof port.addEventListener === 'function') port.addEventListener('close', listener);
	else port.onclose = listener;
}

function closePort(port) {
	try { port?.close?.(); } catch { /* Already entangled with a dead peer. */ }
}

function safePost(port, message, transfer) {
	try { port?.postMessage?.(message, transfer); } catch { /* The peer is gone; the closure still stands. */ }
}

function safeInteger(value) {
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : -1;
}

function boundedInteger(value, minimum, maximum, fallback) {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) return fallback;
	return Math.max(minimum, Math.min(maximum, number));
}
