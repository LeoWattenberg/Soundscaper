/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Fixtures shared by the headless audio editor controller tests.
 *
 * These stand apart from the suite that grew them so that a focused controller
 * test can reach the same mock buffer, store readers and encoder doubles without
 * copying them, and so the suite itself stays a list of behaviours.
 */

export class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel) { return this.channels[channel]; }
	copyToChannel(values, channel, offset = 0) { this.channels[channel].set(values, offset); }
}

export function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

export async function waitFor(predicate, attempts = 100) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error('Timed out waiting for the controller test condition.');
}

export async function storedSample(store, sourceId, frame) {
	return storedChannelSample(store, sourceId, 0, frame);
}

export async function storedChannelSample(store, sourceId, channel, frame) {
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		if (frame < offset + chunk.frames) return chunk.channels[channel][frame - offset];
		offset += chunk.frames;
	}
	throw new RangeError(`Source ${sourceId} does not contain frame ${frame}.`);
}

export function waitWithSignal(promise, signal) {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const abort = () => reject(abortError());
		signal.addEventListener('abort', abort, { once: true });
		promise.then(
			(value) => { signal.removeEventListener('abort', abort); resolve(value); },
			(error) => { signal.removeEventListener('abort', abort); reject(error); },
		);
	});
}

export function abortError() {
	const error = new Error('cancelled');
	error.name = 'AbortError';
	return error;
}

export function createMemoryFfmpeg() {
	return {
		disposeCalls: 0,
		dispose() { this.disposeCalls += 1; },
	};
}

export function createVideoMemoryFfmpeg() {
	return {
		videoCalls: [],
		disposeCalls: 0,
		async encodeVideo(videoBlobs, audioMixBlob, plan, options) {
			this.videoCalls.push({ videoBlobs, audioMixBlob, plan, options });
			return {
				bytes: new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode(plan.format)]),
				mimeType: plan.mimeType,
			};
		},
		dispose() { this.disposeCalls += 1; },
	};
}
