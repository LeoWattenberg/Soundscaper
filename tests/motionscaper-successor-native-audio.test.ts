/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { streamFramescaperSuccessorNativeAudio } from '../src/framescaper/editor-successor-native-audio.ts';
import type { ProductNativeRenderInputOperation } from '../src/common/editor/controller/composition/product-native-render-input-authority.ts';
const plan = { identity: { projectId: 'frame', revisionDigest: 'a'.repeat(64), sequenceId: 'sequence' }, width: 2, height: 2, frameRate: { num: 30000, den: 1001 }, firstFrame: 0, frameCount: 3 };
const signal = new AbortController().signal;
await test('successor PCM uses bounded committed mix blocks, exact fractional-rate enclosure and sink backpressure', async () => {
	const counts: number[] = []; let writes = 0, rendering = false;
	const operation: ProductNativeRenderInputOperation = { project: {}, signal, assertCurrent() {}, finish() {}, renderAudio: async () => { throw new Error('Whole mix allocation is forbidden'); },
		async renderAudioToSink(_project, range, sink) {
			assert.equal(range.outputFrames, 4805); assert.equal(range.chunkFrames, 4096); rendering = true;
			for (const [frameOffset, frames] of [[0, 4096], [4096, 709]]) { await sink([new Float32Array(frames).fill(0.25)], { frameOffset, frames, sampleRate: 48000 }); assert.equal(writes, frameOffset === 0 ? 1 : 2); }
			rendering = false; return { sampleRate: 48000, channelCount: 1, frameCount: 4805, chunkCount: 2 };
		} };
	await streamFramescaperSuccessorNativeAudio({ operation, project: {}, plan, signal, assertCurrent() {}, audio: { sampleRate: 48000, channels: 2, async write(block) {
		assert.equal(rendering, true); assert.equal(block.compositionId, 'sequence'); counts.push(block.sampleCount); assert.ok(block.interleaved.every(value => value === 0.25)); await Promise.resolve(); writes++;
	} } });
	assert.deepEqual(counts, [4096, 709]); assert.equal(rendering, false);
});
await test('successor PCM refuses discontinuous source chunks before writing and surfaces cancellation', async () => {
	let writes = 0; const abort = new AbortController();
	const operation: ProductNativeRenderInputOperation = { project: {}, signal: abort.signal, assertCurrent() {}, finish() {}, renderAudio: async () => null,
		async renderAudioToSink(_project, _range, sink) { await sink([new Float32Array(2)], { frameOffset: 1, frames: 2, sampleRate: 48000 }); throw new Error('unreachable'); } };
	const options = { operation, project: {}, plan, signal: abort.signal, assertCurrent() {}, audio: { sampleRate: 48000, channels: 2 as const, async write() { writes++; } } };
	await assert.rejects(streamFramescaperSuccessorNativeAudio(options), /geometry/u); assert.equal(writes, 0);
	abort.abort(new Error('cancel exact export')); await assert.rejects(streamFramescaperSuccessorNativeAudio(options), /cancel exact/u); assert.equal(writes, 0);
});
