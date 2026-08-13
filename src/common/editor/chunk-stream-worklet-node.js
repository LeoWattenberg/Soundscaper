/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME,
	AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
} from './chunk-stream.js';

const loadedWorkletContexts = new WeakSet();
const pendingWorkletLoads = new WeakMap();

export async function ensureChunkStreamWorklet(audioContext) {
	if (!audioContext?.audioWorklet?.addModule) throw new TypeError('An AudioContext with audioWorklet support is required.');
	if (loadedWorkletContexts.has(audioContext)) return;
	let load = pendingWorkletLoads.get(audioContext);
	if (!load) {
		load = Promise.resolve(chunkStreamWorkletUrl())
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

function chunkStreamWorkletUrl() {
	// Vite copies generic `new URL(..., import.meta.url)` assets without
	// bundling their relative imports. Emit a self-contained worker chunk so
	// the worklet does not request a missing relative `chunk-stream.js` asset.
	if (import.meta.env?.DEV || import.meta.env?.PROD) {
		return import('./chunk-stream-worklet.js?worker&url')
			.then((module) => module.default);
	}
	// Node tests do not run through Vite and use mocked AudioWorklet loading.
	return new URL('./chunk-stream-worklet.js', import.meta.url);
}

export async function createChunkStreamAudioNode(audioContext, options = {}) {
	await ensureChunkStreamWorklet(audioContext);
	const NodeConstructor = options.AudioWorkletNode || globalThis.AudioWorkletNode;
	if (typeof NodeConstructor !== 'function') throw new Error('AudioWorkletNode is not available in this browser.');
	const channelCount = boundedInteger(options.channelCount ?? 2, 1, 64, 'channelCount');
	return new NodeConstructor(audioContext, AUDIO_EDITOR_CHUNK_STREAM_WORKLET_NAME, {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		processorOptions: {
			channelCount,
			maxQueuePackets: options.maxQueuePackets ?? AUDIO_EDITOR_STREAM_MAX_QUEUE_PACKETS,
			prebufferPackets: options.prebufferPackets ?? 4,
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
