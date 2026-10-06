/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { matchAudacitySelectionChannels } from '../src/common/editor/audacity-selection.js';
import { runSelectionEffectChain } from '../src/common/editor/selection-effect-chain.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { isBatchableSelectionEffectStep, type SelectionEffectChainStep } from '../src/common/editor/selection-effect-chain-contract.ts';

const input = [Float32Array.of(-0, 0, 1.401298464324817e-45, -1.401298464324817e-45, .25, -.125, .5), Float32Array.of(.125, -.25, -.5, .75, 0, -0, 1e-40)];
const steps: SelectionEffectChainStep[] = [
	{ effectType: 'audacity-fade-in', params: {} },
	{ effectType: 'audacity-repeat', params: { count: 2 } },
	{ effectType: 'audacity-amplify', params: { gainDb: -6, allowClipping: false } },
	{ effectType: 'audacity-reverse', params: {} },
	{ effectType: 'audacity-normalize', params: { peakDb: -3, removeDc: true, independent: false } },
];

test('one private packet exactly matches actual serial DSP and channel matching after each length-changing step', async () => {
	for (const channels of [input.slice(0, 1), input]) {
		let expected = channels.map((channel) => channel.slice());
		for (const step of steps) expected = matchAudacitySelectionChannels(await applyAudioSelectionEffectAsync(step.effectType, expected, 48000, step.params), expected.length);
		const actual = await runSelectionEffectChain(steps, channels.map((channel) => channel.slice()), 48000, applyAudioSelectionEffectAsync);
		assert.deepEqual(actual, expected);
		for (const [index, channel] of actual.entries()) assert.deepEqual(new Uint8Array(channel.buffer), new Uint8Array(expected[index]!.buffer));
	}
});

test('inter-step signed zero and subnormal PCM, fixed source layout, and independent channel copies are preserved', async () => {
	let calls = 0;
	const actual = await runSelectionEffectChain(steps.slice(0, 2), [input[0]!.slice()], 48000, async (_type, channels) => {
		calls++; assert.equal(Object.is(channels[0]![0], -0), true); assert.equal(channels[0]![2], input[0]![2]);
		return [channels[0]!, Float32Array.of(0, 0, 0, 0, 0, 0, 0)];
	});
	assert.equal(calls, 2); assert.equal(actual.length, 1); assert.notEqual(actual[0], input[0]);
});

test('closed packets reject context, realtime and reviewed effects before any DSP and cap step count', async () => {
	for (const effectType of ['audacity-repair', 'audacity-change-pitch', 'audacity-auto-duck', 'audacity-compressor', 'eq', 'reviewed-utility-gain', 'unknown']) {
		assert.equal(isBatchableSelectionEffectStep({ effectType, params: {} }), false);
		await assert.rejects(runSelectionEffectChain([{ effectType, params: {} }], input, 48000, async () => { throw new Error('DSP must not start'); }), /Unsupported selection effect chain/);
	}
	await assert.rejects(runSelectionEffectChain(Array.from({ length: 33 }, () => steps[0]!), input, 48000, applyAudioSelectionEffectAsync), /one to 32/);
});

test('headless chain fallback fences each individual DSP completion and worker packets retain each step timeout', async () => {
	const { createSelectionEffectWorkerService } = await import('../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts');
	let current = true; let calls = 0; const reason = new Error('stale');
	const runtime = { state: { audacityEffectWorker: null, spectralWorker: null }, copy: { effectProcessingFailed: 'failed' }, workerAvailable: () => false,
		captureProject: () => ({ projectId: 'project', generation: 1 }), assertProject: () => { if (!current) throw reason; },
		loadParametricEqWasmModule: async () => null, initializePffft: async () => null, captureNoiseProfile: () => null,
		applySelectionEffect: async (_type: string, channels: Float32Array[]) => { calls++; current = false; return channels; }, applySpectralGain: (channels: Float32Array[]) => channels };
	await assert.rejects(createSelectionEffectWorkerService(runtime).runSelectionEffectWorker({ operation: 'apply-chain', steps: steps.slice(0, 2), channels: [input[0]!.slice()], sampleRate: 48000, params: undefined }), (error: unknown) => error === reason);
	assert.equal(calls, 1);
	current = true;
	const callbacks: Array<() => void> = []; const cleared: unknown[] = [];
	const worker: import('../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts').EffectWorkerLike = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} };
	const service = createSelectionEffectWorkerService({ ...runtime, workerAvailable: () => true, createSelectionWorker: () => worker,
		setTimeout: (callback) => { callbacks.push(callback); return callbacks.length as unknown as ReturnType<typeof globalThis.setTimeout>; }, clearTimeout: (handle) => { cleared.push(handle); } });
	const running = service.runSelectionEffectWorker({ operation: 'apply-chain', steps: steps.slice(0, 2), channels: [input[0]!.slice()], sampleRate: 48000, params: undefined });
	void running.catch(() => undefined);
	assert.equal(callbacks.length, 1);
	worker.onmessage!({ data: { type: 'chain-step', completed: 1 } });
	assert.equal(callbacks.length, 2); assert.equal(cleared.length, 1);
	worker.onmessage!({ data: { type: 'chain-step', completed: 1 } });
	worker.onmessage!({ data: { type: 'chain-step', completed: 9 } });
	assert.equal(callbacks.length, 2, 'duplicate and out-of-order completions cannot extend the deadline');
	callbacks[1]!(); await assert.rejects(running, { name: 'TimeoutError' });
});


test('packet admission stays in eager effect contracts while DSP orchestration keeps its lazy execution owner', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/selection-effect-chain-contract.ts'), 'editor-effect-contracts');
	assert.equal(chunkGroupForModulePath('src/common/editor/selection-effect-chain.ts'), 'editor-optional-execution');
});
