/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { processIndependentSelectionTargets } from '../src/common/editor/controller/effects/internal/independent-selection-targets.ts';
import type { SelectionEffectWorkerRequest } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';

for (const concurrent of [false, true]) test(`independent ${concurrent ? 'concurrent' : 'serial'} track jobs retain their stereo channel clock`, async () => {
	const stereo = [new Float32Array(2_000).fill(0.35), new Float32Array(2_000).fill(0.35)];
	stereo[0]!.fill(0, 300, 1_300); stereo[1]!.fill(0, 700, 1_700);
	const mono = new Float32Array(2_000).fill(0.35); mono.fill(0, 300, 1_300);
	const params = { independent: true, minimumSilence: 0.5, truncateTo: 0 };
	const worker = async (request: SelectionEffectWorkerRequest) => ({ channels: await applyAudioSelectionEffectAsync(
		request.effectType, request.channels, request.sampleRate, request.params, request.context) });
	const outputs = await processIndependentSelectionTargets({
		dryResults: [
			{ target: { track: { id: 'stereo' }, startFrame: 0, endFrame: 2_000, channelCount: 2 }, channels: stereo },
			{ target: { track: { id: 'mono' }, startFrame: 0, endFrame: 2_000, channelCount: 1 }, channels: [mono] },
		], effectType: 'audacity-truncate-silence', sampleRate: 1_000, params,
		definition: {}, spectralSelections: new Map(), controlChannels: null, controlTrackId: '', noiseProfile: null,
		contextFrames: 0, afterContextFrames: 0, projectFrameCount: () => 2_000, assertCurrent: () => undefined,
		renderDryRange: async () => assert.fail('No context required.'), runSelectionEffectWorker: worker,
		runIndependentSelectionEffects: concurrent ? async requests => Promise.all(requests.map(worker)) : undefined,
	});
	assert.deepEqual(outputs.map(output => output.channels?.map(channel => channel.length)), [[1_400, 1_400], [1_000]]);
	assert.equal(outputs[0]?.channels?.[0]?.[350], 0, 'left microphone pause retains its earlier position');
	assert.equal(outputs[0]?.channels?.[1]?.[350], Math.fround(0.35), 'right microphone keeps its synchronized sound');
	assert.equal(params.independent, true, 'dialog/repeat remembers the track-level choice');
	assert.equal(stereo[0]!.length, 2_000);
});
