/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The independent recomputation the synthetic engine was designed around.
 *
 * The engine renders from an integer hash rather than an oscillator precisely
 * so a second implementation can reproduce it bit for bit, and the addon
 * exports its own expected-sample function for the comparison. Both halves of
 * that comparison living in the same C file proves nothing, so the reference
 * here is written in JavaScript from the documented operations and is what the
 * rendered blocks are checked against.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { addonIsBuilt, loadAddon } from './helpers/native-helper-c-harness.js';
import {
	SYNTHETIC_MODES,
	deterministicSample,
	expectedSyntheticSample,
} from './helpers/synthetic-engine-reference.js';

const BLOCK_FRAMES = 512;

test('the JavaScript reference reproduces the addon\'s expected sample exactly', { skip: !addonIsBuilt }, () => {
	const native = loadAddon();
	for (const generation of [0, 1, 7, 65_535, 4_294_967_295]) {
		for (const channel of [0, 1, 31]) {
			for (const frame of [0, 1, 2, 47, 1_023, 4_294_967_295, 4_294_967_296, 9_007_199_254_740_991]) {
				const configuration = { generation, mode: SYNTHETIC_MODES.tone };
				assert.equal(
					expectedSyntheticSample(configuration, channel, frame),
					native.expectedSyntheticSample(configuration, channel, frame),
					`generation ${String(generation)}, channel ${String(channel)}, frame ${String(frame)}`,
				);
			}
		}
	}
	// The generating modes that are not a hash must agree as well, including the
	// impulse's single non-zero frame.
	for (const mode of [SYNTHETIC_MODES.impulse, SYNTHETIC_MODES.gain, SYNTHETIC_MODES.passthrough]) {
		for (const frame of [0, 1, 4_096]) {
			const configuration = { generation: 3, mode };
			assert.equal(
				expectedSyntheticSample(configuration, 0, frame),
				native.expectedSyntheticSample(configuration, 0, frame),
			);
		}
	}
});

test('every rendered tone sample matches the independent recomputation', { skip: !addonIsBuilt }, () => {
	const native = loadAddon();
	const channelCount = 4;
	const generation = 11;
	const engine = native.createSyntheticEngine({
		channelCount,
		frameCount: BLOCK_FRAMES,
		sampleRate: 48_000,
		generation,
		mode: SYNTHETIC_MODES.tone,
		fault: 0,
		gain: 1,
		faultFrame: 0,
	});
	const channels = Array.from({ length: channelCount }, () => new Float32Array(BLOCK_FRAMES));
	for (let block = 0; block < 3; block += 1) {
		const startFrame = block * BLOCK_FRAMES;
		native.renderSyntheticBlock(engine, startFrame, BLOCK_FRAMES, null, channels);
		for (const [channel, samples] of channels.entries()) {
			for (const [index, sample] of samples.entries()) {
				assert.equal(sample, deterministicSample(generation, channel, startFrame + index),
					`channel ${String(channel)} frame ${String(startFrame + index)}`);
			}
		}
	}
});

test('the reference detects a rendered block that is not the engine\'s own generation', { skip: !addonIsBuilt }, () => {
	const native = loadAddon();
	const engine = native.createSyntheticEngine({
		channelCount: 1,
		frameCount: BLOCK_FRAMES,
		sampleRate: 48_000,
		generation: 5,
		mode: SYNTHETIC_MODES.tone,
		fault: 0,
		gain: 1,
		faultFrame: 0,
	});
	const channels = [new Float32Array(BLOCK_FRAMES)];
	native.renderSyntheticBlock(engine, 0, BLOCK_FRAMES, null, channels);
	// A verifier that cannot tell one generation from another would accept a
	// stale packet as a live one, so the negative case is asserted too.
	assert.notEqual(channels[0][1], deterministicSample(6, 0, 1));
	assert.equal(channels[0][1], deterministicSample(5, 0, 1));
});
