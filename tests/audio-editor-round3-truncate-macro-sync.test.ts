/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroChainRunner, planEffectMacroChain,
	type EffectMacroChainRuntime } from '../src/common/editor/controller/effects/internal/macro/effect-macro-chain.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { runSelectionEffectChain } from '../src/common/editor/selection-effect-chain.ts';

for (const batched of [false, true]) test(`${batched ? 'batched' : 'single-step'} macro truncation keeps stereo microphones synchronized`, async () => {
	const input = [new Float32Array(2_000).fill(0.35), new Float32Array(2_000).fill(0.35)];
	input[0]!.fill(0, 300, 1_300); input[1]!.fill(0, 700, 1_700);
	const params = { independent: true, minimumSilence: 0.5, truncateTo: 0 };
	const runtime: EffectMacroChainRuntime = {
		sampleRate: 1_000, projectFrameCount: () => 2_000,
		copy: { autoDuckControlTrack: 'Control required', effectInvalidAudio: 'Invalid', noiseProfileMissing: 'Profile missing' },
		assertCurrent: () => undefined,
		renderDryRange: async () => assert.fail('No neighbours needed'),
		runSelectionEffect: async request => ({ channels: await applyAudioSelectionEffectAsync(
			request.effectType, request.channels, request.sampleRate, request.params, request.context) }),
		runSelectionEffectChain: batched ? async request => ({ channels: await runSelectionEffectChain(
			request.steps, [...request.channels], request.sampleRate, applyAudioSelectionEffectAsync) }) : undefined,
		createAudioBuffer: async () => assert.fail('No realtime rack'),
		renderSnapshot: async () => assert.fail('No realtime rack'),
		audioBufferChannels: () => assert.fail('No realtime rack'),
		matchSelectionChannels: channels => [...channels],
	};
	const runner = createEffectMacroChainRunner(runtime);
	const segments = planEffectMacroChain([
		{ id: 'truncate', type: 'audacity-truncate-silence', params },
		...(batched ? [{ id: 'truncate-again', type: 'audacity-truncate-silence', params }] : []),
	]);
	const output = await runner.runSegments(segments, input.map(channel => channel.slice()),
		{ track: { id: 'stereo' }, startFrame: 0, endFrame: 2_000, channelCount: 2 });
	assert.deepEqual(output.map(channel => channel.length), [1_400, 1_400]);
	assert.equal(output[0]![350], 0);
	assert.equal(output[1]![350], Math.fround(0.35));
	assert.equal(params.independent, true);
	assert.equal(input[0]!.length, 2_000);
});
