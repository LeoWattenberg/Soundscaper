/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect, effectTailFrames } from '../src/common/editor/effects.js';
import {
	audacityLiveEffectCapability, audacityLiveEffectLatencyFrames,
	audacityLiveEffectTailFrames, isAudacityLiveEffect,
} from '../src/common/editor/audacity-effects/live-capabilities.js';
import { AudacityLiveEffectProcessor } from '../src/common/editor/audacity-effects/live-worklet.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();
const SAMPLE_RATE = 48_000;

test('Audacity Reverb is available as a rack effect with native controls and gain defaults', () => {
	assert.equal(isAudacityLiveEffect('audacity-reverb'), true);
	const effect = createEffect('audacity-reverb', { id: 'live-reverb' });
	assert.deepEqual(Object.keys(effect.params), [
		'roomSize', 'preDelay', 'reverberance', 'damping', 'toneLow', 'toneHigh',
		'wetGainDb', 'dryGainDb', 'stereoWidth', 'wetOnly',
	]);
	assert.equal(effect.params.wetGainDb, -1);
	assert.equal(effect.params.dryGainDb, -1);
	assert.equal(audacityLiveEffectCapability(effect.type).mode, 'live');
	assert.equal(audacityLiveEffectLatencyFrames(effect.type, SAMPLE_RATE), 0);
	const tail = audacityLiveEffectTailFrames(effect.type, SAMPLE_RATE, effect.params);
	assert.ok(Number.isSafeInteger(tail) && tail > 0);
	assert.equal(effectTailFrames(effect, SAMPLE_RATE), tail);
	assert.equal(effectTailFrames({ ...effect, enabled: false }, SAMPLE_RATE), 0);
	assert.equal(effectTailFrames({ ...effect, params: { ...effect.params, reverberance: 0 } }, SAMPLE_RATE), 0);
});

test('Reverb worklet retains wet audio across render quanta and accepts reset and control messages', () => {
	const worklet = new AudacityLiveEffectProcessor({ processorOptions: {
		effectType: 'audacity-reverb', sampleRate: SAMPLE_RATE,
		params: { wetOnly: true, preDelay: 10, wetGainDb: 0 },
	} });
	assert.equal(worklet.lastError, null);
	assert.ok(worklet.processor);
	let wetSamples = 0;
	for (let block = 0; block < 40; block += 1) {
		const input = new Float32Array(128);
		if (block === 0) input[0] = 1;
		const output = new Float32Array(128);
		assert.equal(worklet.process([[input]], [[output]]), true);
		assert.equal(worklet.lastError, null);
		for (const sample of output) if (sample !== 0) wetSamples += 1;
	}
	assert.ok(wetSamples > 0, 'the pre-delay and reverberator must survive 128-frame quanta');

	// The browser supplies MessagePort; the Node worklet fallback has the same callback contract.
	const port = worklet.port as unknown as { onmessage: (event: { data: unknown }) => void };
	port.onmessage({ data: { type: 'reset' } });
	const silence = new Float32Array(128);
	const resetOutput = new Float32Array(128);
	worklet.process([[silence]], [[resetOutput]]);
	assert.ok(resetOutput.every(sample => sample === 0));
	port.onmessage({ data: { type: 'params', params: { wetOnly: false, dryGainDb: 0, preDelay: 0 } } });
	const impulse = new Float32Array(128);
	impulse[0] = 1;
	const dryOutput = new Float32Array(128);
	worklet.process([[impulse]], [[dryOutput]]);
	assert.equal(worklet.lastError, null);
	assert.equal(dryOutput[0], 1);
});
