import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyAudioSelectionEffectAsync,
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from '../src/common/editor/selection-effects.js';
import { loadParametricEqWasmModule } from '../src/common/editor/parametric-eq/wasm-loader.js';

const wasmModule = await loadParametricEqWasmModule();

test('selection dispatcher routes canonical EQ with pre-roll and returns only the requested frames', async () => {
	const before = Float32Array.of(0.5, -0.25, 0.125);
	const input = Float32Array.of(0.1, -0.2, 0.3, -0.4);
	const beforeRollback = before.slice();
	const inputRollback = input.slice();
	const output = await applyAudioSelectionEffectAsync('eq', [input], 48_000, {
		outputGain: 6,
		bands: [],
	}, {
		beforeChannels: [before],
		wasmModule,
	});
	const gain = 10 ** (6 / 20);
	assert.equal(output.length, 1);
	assert.equal(output[0].length, input.length);
	for (let frame = 0; frame < input.length; frame += 1) {
		assert.ok(Math.abs(output[0][frame] - input[frame] * gain) < 1e-7);
	}
	assert.deepEqual(before, beforeRollback);
	assert.deepEqual(input, inputRollback);
	assert.notEqual(output[0], input);
});

test('selection dispatcher retains Audacity behavior behind the generalized entry point', async () => {
	const input = Float32Array.of(-0.5, 0, 0.25);
	const output = await applyAudioSelectionEffectAsync('audacity-invert', [input], 48_000, {});
	assert.deepEqual(output[0], Float32Array.of(0.5, -0, -0.25));
	assert.deepEqual(input, Float32Array.of(-0.5, 0, 0.25));
	assert.throws(
		() => estimateAudioSelectionEffectOutputFrames('eq', 0, { bands: [] }),
		/positive safe integer/,
	);
});

test('EQ selection estimates include pre-roll while preserving length and validating context layout', async () => {
	const params = { outputGain: 0, bands: [] };
	assert.equal(estimateAudioSelectionEffectOutputFrames('eq', 4_096, params), 4_096);
	const withoutPreRoll = estimateAudioSelectionEffectPeakBytes('eq', 4_096, params, {
		channelCount: 2,
	});
	const withPreRoll = estimateAudioSelectionEffectPeakBytes('eq', 4_096, params, {
		channelCount: 2,
		beforeFrames: 2_048,
	});
	assert.ok(withPreRoll > withoutPreRoll);
	await assert.rejects(
		applyAudioSelectionEffectAsync('eq', [new Float32Array(4)], 48_000, params, {
			beforeChannels: [new Float32Array(2), new Float32Array(2)],
			wasmModule,
		}),
		/match the parametric EQ channel count/,
	);
});
