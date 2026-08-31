/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioClip, createAudioSource } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';

export function sourceFixture(options = {}) {
	return createAudioSource({
		id: 'source-a', storageKey: 'source-a', name: 'Source A', mimeType: 'audio/wav',
		frameCount: 32, channelCount: 1, sampleRate: 8_000, originalSampleRate: 8_000,
		...options,
	});
}

export function clipFixture(options = {}) {
	return createAudioClip({
		id: 'clip-a', sourceId: 'source-a', title: 'Clip A', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 16, durationFrames: 16, speedRatio: 1,
		...options,
	});
}

export async function sourceStore(name) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `clip-time-pitch-${name}-${Date.now()}-${Math.random()}`,
		storageManager: null,
	});
	const writer = await store.beginSourceWrite('source-a', { sampleRate: 8_000, channelCount: 1 });
	await writer.write([Float32Array.from({ length: 32 }, (_, index) => index)]);
	await writer.commit();
	return store;
}

export class FakeStaffPadClient {
	constructor() {
		this.calls = [];
		this.gates = [];
		this.waiters = [];
	}

	blockNext() {
		const gate = deferred();
		this.gates.push(gate);
		return gate;
	}

	async waitForCalls(count) {
		if (this.calls.length >= count) return;
		const waiter = deferred();
		this.waiters.push({ count, waiter });
		await waiter.promise;
	}

	async render(request, options = {}) {
		const gate = this.gates.shift() || null;
		const call = {
			request,
			signal: options.signal,
			cacheKey: options.cacheKey,
			transferInput: options.transferInput,
			outputChannels: null,
		};
		this.calls.push(call);
		for (const entry of this.waiters.splice(0)) {
			if (this.calls.length >= entry.count) entry.waiter.resolve();
			else this.waiters.push(entry);
		}
		if (gate) await waitWithAbort(gate.promise, options.signal);
		if (options.signal?.aborted) throw abortError();
		options.onProgress?.(0.5);
		const channels = request.channels.map((input) => {
			const output = new Float32Array(request.outputFrames);
			for (let frame = 0; frame < output.length; frame += 1) {
				const sourceFrame = request.selection.startFrame
					+ Math.min(request.selection.frameCount - 1,
						Math.floor(frame * request.selection.frameCount / output.length));
				output[frame] = input[sourceFrame];
			}
			return output;
		});
		call.outputChannels = channels;
		options.onProgress?.(1);
		return { channels, cacheKey: options.cacheKey };
	}

	dispose() {}
}

export function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function waitWithAbort(promise, signal) {
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

function abortError() {
	const error = new Error('cancelled');
	error.name = 'AbortError';
	return error;
}
