/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroChainRunner, planEffectMacroChain,
	type EffectMacroChainRuntime } from '../src/common/editor/controller/effects/internal/macro/effect-macro-chain.ts';

function fixture(contextCacheBytes: number, cancelAfterFirst = false) {
	const renders: Array<readonly [number, number]> = [];
	const neighbours: number[][] = [];
	let current = true;
	let jobs = 0;
	const runtime: EffectMacroChainRuntime & { readonly contextCacheBytes: number } = {
		contextCacheBytes, sampleRate: 48_000, projectFrameCount: () => 10_000,
		copy: { autoDuckControlTrack: 'Control required', effectInvalidAudio: 'Invalid', noiseProfileMissing: 'Profile missing' },
		assertCurrent: () => { if (!current) throw new DOMException('Cancelled', 'AbortError'); },
		renderDryRange: async (_track, from, to) => {
			renders.push([from, to]);
			return [Float32Array.from({ length: to - from }, (_, index) => (from + index) / 10_000)];
		},
		runSelectionEffect: async ({ channels, context }) => {
			jobs += 1;
			const before = context.beforeChannels as Float32Array[];
			const after = context.afterChannels as Float32Array[];
			neighbours.push([...before[0]!, ...after[0]!]);
			// A worker consuming or modifying its inputs must never poison a retained range.
			before[0]!.fill(-9);
			after[0]!.fill(-9);
			if (cancelAfterFirst) current = false;
			return { channels: channels.map((channel) => channel.map((sample) => sample + 1)) };
		},
		createAudioBuffer: async () => null,
		renderSnapshot: async () => ({}),
		audioBufferChannels: () => [],
		matchSelectionChannels: (channels) => [...channels],
	};
	const runner = createEffectMacroChainRunner(runtime);
	const target = { track: { id: 'track' }, startFrame: 1_000, endFrame: 1_004, channelCount: 1, clipIds: ['clip'] };
	const segments = planEffectMacroChain([
		{ id: 'first', type: 'audacity-repair', params: {} },
		{ id: 'second', type: 'audacity-repair', params: {} },
	]);
	return { runner, target, segments, renders, neighbours, jobs: () => jobs };
}

test('a macro reuses identical authored neighbours while processing the evolving selection', async () => {
	const value = fixture(1_024);
	const result = await value.runner.runSegments(value.segments, [new Float32Array([0.1, 0.2, 0.3, 0.4])], value.target);
	assert.deepEqual(value.renders, [[872, 1_000], [1_004, 1_132]]);
	assert.deepEqual(value.neighbours[0], value.neighbours[1]);
	assert.deepEqual(result, [new Float32Array([2.1, 2.2, 2.3, 2.4])]);
	// Cache lifetime ends with a run; a later run reads the current authored PCM again.
	await value.runner.runSegments(value.segments, [new Float32Array(4)], value.target);
	assert.equal(value.renders.length, 4);
});

test('a macro whose memory admission leaves no cache budget keeps bounded original reads', async () => {
	for (const budget of [0, 511]) {
		const value = fixture(budget);
		await value.runner.runSegments(value.segments, [new Float32Array(4)], value.target);
		assert.equal(value.renders.length, 4);
	}
});

test('cache hits do not bypass project and task ownership checks', async () => {
	const value = fixture(1_024, true);
	await assert.rejects(value.runner.runSegments(value.segments, [new Float32Array(4)], value.target), { name: 'AbortError' });
	assert.equal(value.jobs(), 1);
});
