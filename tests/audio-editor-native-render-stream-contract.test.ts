/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';
import { renderProductNativeAudioToSink, type ProductNativeRenderAudioStreamDependencies } from '../src/common/editor/controller/product-native-render-audio-stream.ts';

// The production engine's buffer and streaming signatures must survive this port.
function engineContract(engine: EnginePublicApi): ProductNativeRenderAudioStreamDependencies<Map<string, AudioBuffer>>['createRenderEngine'] {
	return () => engine;
}
void engineContract;

void test('native PCM delivery fences each sink chunk and disposes after a revision change', async () => {
	let current = true;
	let delivered = 0;
	let disposed = 0;
	const stale = new Error('stale revision');
	await assert.rejects(renderProductNativeAudioToSink({
		signal: new AbortController().signal, sourceBuffers: new Map<string, AudioBuffer>(),
		assertCurrent() { if (!current) throw stale; },
		async prepareCommittedTimePitchCaches() {},
		createRenderEngine: () => ({ loadProject() {}, async renderMixToSink(options) {
			const sink = options.sink;
			assert.equal(typeof sink, 'function');
			assert.ok(typeof sink === 'function');
			await sink([new Float32Array([1])], { sampleRate: 48000, frameOffset: 0, frames: 1 });
			return { sampleRate: 48000, channelCount: 1, frameCount: 1, chunkCount: 1 };
		}, dispose() { disposed += 1; } }),
	}, {}, {}, async () => { delivered += 1; current = false; }), error => error === stale);
	assert.equal(delivered, 1);
	assert.equal(disposed, 1);
});
