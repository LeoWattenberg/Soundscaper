/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS, AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES } from './chunk-stream.js';
import {
	NATIVE_REALTIME_MAX_GENERATION,
	NATIVE_REALTIME_MAX_QUEUE_PACKETS,
	NATIVE_REALTIME_PROTOCOL_VERSION,
} from './native-realtime-transport.ts';
import {
	NATIVE_REALTIME_CONTROL,
	NATIVE_REALTIME_REVOKE_REASON,
	NATIVE_REALTIME_WORKLET_NAME,
} from './native-realtime-worklet.js';
import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

const loadedWorkletContexts = new WeakSet();
const pendingWorkletLoads = new WeakMap();

export async function ensureNativeRealtimeWorklet(audioContext) {
	if (!audioContext?.audioWorklet?.addModule) throw new TypeError('An AudioContext with audioWorklet support is required.');
	if (loadedWorkletContexts.has(audioContext)) return;
	let load = pendingWorkletLoads.get(audioContext);
	if (!load) {
		load = Promise.resolve(nativeRealtimeWorkletUrl())
			.then((url) => audioContext.audioWorklet.addModule(url));
		pendingWorkletLoads.set(audioContext, load);
	}
	try {
		await load;
		loadedWorkletContexts.add(audioContext);
		pendingWorkletLoads.delete(audioContext);
	} catch (error) {
		if (pendingWorkletLoads.get(audioContext) === load) pendingWorkletLoads.delete(audioContext);
		throw error;
	}
}

function nativeRealtimeWorkletUrl() {
	// Vite copies generic `new URL(..., import.meta.url)` assets without
	// bundling their relative imports. Emit a self-contained worker chunk so
	// the worklet does not request a missing relative transport asset.
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		return import('./native-realtime-worklet.js?worker&url')
			.then((module) => module.default);
	}
	// Node tests do not run through Vite and use mocked AudioWorklet loading.
	return new URL('./native-realtime-worklet.js', import.meta.url);
}

/**
 * Builds the transport node and returns renderer main's whole share of the
 * 5A-0c data plane: hand the helper's port across, authorize one generation on
 * it, and be able to take it away again. Every packet afterwards travels
 * helper -> worklet without touching this thread, which is the property the
 * milestone stops on if Electron cannot provide it.
 */
export async function createNativeRealtimeWorkletNode(audioContext, options = {}) {
	await ensureNativeRealtimeWorklet(audioContext);
	const NodeConstructor = options.AudioWorkletNode || globalThis.AudioWorkletNode;
	if (typeof NodeConstructor !== 'function') throw new Error('AudioWorkletNode is not available in this browser.');
	const channelCount = boundedInteger(
		options.channelCount ?? 2,
		1,
		PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels,
		'channelCount',
	);
	const packetFrames = boundedInteger(
		options.packetFrames ?? AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		1,
		PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames,
		'packetFrames',
	);
	const maxQueuePackets = boundedInteger(
		options.maxQueuePackets ?? AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
		1,
		NATIVE_REALTIME_MAX_QUEUE_PACKETS,
		'maxQueuePackets',
	);
	const node = new NodeConstructor(audioContext, NATIVE_REALTIME_WORKLET_NAME, {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		processorOptions: {
			channelCount,
			packetFrames,
			maxQueuePackets,
			prebufferPackets: options.prebufferPackets ?? 2,
		},
	});

	let issued = 0;
	let authorized = 0;
	let disposed = false;
	node.port.onmessage = ({ data = {} } = {}) => {
		if (data.type === NATIVE_REALTIME_CONTROL.closed) {
			if (data.generation === authorized) authorized = 0;
			options.onClose?.(data);
		} else if (data.type === NATIVE_REALTIME_CONTROL.underrun) options.onUnderrun?.(data);
		else if (data.type === NATIVE_REALTIME_CONTROL.attached) options.onAttach?.(data);
		else if (data.type === NATIVE_REALTIME_CONTROL.opened) options.onOpen?.(data);
		else if (data.type === NATIVE_REALTIME_CONTROL.discarded) options.onDiscard?.(data);
		else if (data.type === NATIVE_REALTIME_CONTROL.rejected) options.onReject?.(data);
	};
	node.port.start?.();

	const post = (type, generation, extra = {}) => {
		node.port.postMessage({
			type,
			protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
			generation,
			...extra,
		});
	};

	return Object.freeze({
		node,
		get generation() { return authorized; },
		get channelCount() { return channelCount; },
		get packetFrames() { return packetFrames; },

		/**
		 * Hands the helper's port to the processor and authorizes one
		 * generation on it. The port rides the transfer list, never the message
		 * body: a copy would leave main entangled with the helper and put it
		 * back in the per-block path it must stay out of.
		 */
		attach(port, config = {}) {
			if (disposed) throw new Error('The native realtime transport node is disposed.');
			if (!port || typeof port.postMessage !== 'function') {
				throw new TypeError('attach() requires a MessagePort transferred from the native helper.');
			}
			const requested = config.generation == null ? issued + 1 : Number(config.generation);
			if (!Number.isSafeInteger(requested) || requested <= issued || requested > NATIVE_REALTIME_MAX_GENERATION) {
				throw new RangeError('A native realtime generation must increase and stay inside the wire range.');
			}
			node.port.postMessage({
				type: NATIVE_REALTIME_CONTROL.attach,
				protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION,
				generation: requested,
			}, [port]);
			// A number is burned for good once it is issued, so it is spent only
			// on an attach that left this thread: recording one the processor
			// never received would revoke a generation it does not have and lock
			// the retry out of the number it never used.
			issued = requested;
			authorized = requested;
			return requested;
		},

		/** The worklet is the authority on close reasons and narrows this one. */
		revoke(reason = NATIVE_REALTIME_REVOKE_REASON) {
			if (!authorized) return 0;
			const revoked = authorized;
			authorized = 0;
			post(NATIVE_REALTIME_CONTROL.revoke, revoked, { reason });
			return revoked;
		},

		/**
		 * Main supervises the helper, so it sees a crash the worklet's port may
		 * only learn about later. Reporting it here closes the generation on
		 * whichever signal arrives first; the second one is a no-op.
		 */
		notifyPeerLoss() {
			if (!authorized) return 0;
			const lost = authorized;
			authorized = 0;
			post(NATIVE_REALTIME_CONTROL.peerLost, lost);
			return lost;
		},

		dispose() {
			if (disposed) return;
			if (authorized) {
				const revoked = authorized;
				authorized = 0;
				post(NATIVE_REALTIME_CONTROL.revoke, revoked, { reason: NATIVE_REALTIME_REVOKE_REASON });
			}
			disposed = true;
			node.port.onmessage = null;
			try { node.disconnect(); } catch { /* Already disconnected. */ }
		},
	});
}

function boundedInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}
