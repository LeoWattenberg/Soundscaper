/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperDialogueChainFinishing } from '../src/framescaper/editor-audio-dialogue-chain-finishing.ts';
import { effectRackLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { compileProjectPdcPlan } from '../src/common/editor/engine/project-pdc-plan.ts';

// Web Audio's native DynamicsCompressorNode owns an internal 6 ms pre-delay:
// https://www.w3.org/TR/webaudio-1.0/#DynamicsCompressorNode
for (const [sampleRate, compressorFrames, limiterFrames] of [
	[8_000, 48, 40], [44_100, 264, 221], [48_000, 288, 240],
	[96_000, 576, 480], [192_000, 1023, 960],
] as const) {
	test(`the ordinary Dialogue Chain compensates its native compressor at ${sampleRate} Hz`, () => {
		const chain = createFramescaperDialogueChainFinishing({ id: 'dialogue', sampleRate });
		assert.deepEqual(chain.effects.map(effect => effect.type),
			['highpass', 'gate', 'eq', 'compressor', 'limiter']);
		const limiter = chain.effects.find(effect => effect.type === 'limiter');
		assert.equal(limiter?.params.lookahead, .005);
		const expected = compressorFrames + limiterFrames;
		assert.equal(effectRackLatencyFrames(chain.effects, sampleRate), expected);
		const plan = compileProjectPdcPlan({ sampleRate, tracks: [
			{ id: 'dialogue-track', effects: chain.effects },
			{ id: 'dry-track', effects: [] },
		] });
		assert.equal(plan.trackLatencyFrames.get('dialogue-track'), expected);
		assert.equal(plan.trackLatencyFrames.get('dry-track'), 0);
		assert.equal(plan.latencyFrames, expected);
	});
}

test('bypassed dialogue compressors leave only the healthy limiter preview', () => {
	const chain = createFramescaperDialogueChainFinishing({ id: 'dialogue', sampleRate: 48_000 });
	for (const bypass of [{ enabled: false }, { bypassed: true }]) {
		const effects = chain.effects.map(effect => effect.type === 'compressor'
			? { ...effect, ...bypass } : effect);
		assert.equal(effectRackLatencyFrames(effects, 48_000), 240);
	}
	assert.equal(effectRackLatencyFrames(chain.effects.map(effect => ({ ...effect, enabled: false })), 48_000), 0);
});
