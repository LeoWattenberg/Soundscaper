/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CROSSFADE_SHAPE_PRESETS,
	END_FADE_SHAPE_PRESETS,
	selectedCrossfadeShapePreset,
	selectedEndFadeShapePreset,
} from '../src/common/editor/clip-fade-presets.ts';
import { evaluateClipCrossfadeAt, evaluateClipFadeAt } from '../src/common/editor/audio-clip-transition-gain.ts';

const close = (actual: number, expected: number): void => {
	assert.ok(Math.abs(actual - expected) < 1e-12,
		`${String(actual)} differs from ${String(expected)}`);
};

test('crossfade presets preserve their advertised power and volume throughout an overlap', () => {
	const [power, volume] = CROSSFADE_SHAPE_PRESETS;
	assert.equal(power.id, 'constant-power');
	assert.equal(volume.id, 'constant-volume');
	for (const frame of [0, 5, 25, 50, 75, 95, 100]) {
		const outPower = evaluateClipCrossfadeAt(frame, [[0, 100]], 'out', power.shape);
		const inPower = evaluateClipCrossfadeAt(frame, [[0, 100]], 'in', power.shape);
		close(outPower ** 2 + inPower ** 2, 1);
		const outVolume = evaluateClipCrossfadeAt(frame, [[0, 100]], 'out', volume.shape);
		const inVolume = evaluateClipCrossfadeAt(frame, [[0, 100]], 'in', volume.shape);
		close(outVolume + inVolume, 1);
	}
});

test('end-fade presets distinguish exact linear ramps from shaped S-curves', () => {
	assert.deepEqual(END_FADE_SHAPE_PRESETS.map(preset => preset.id), [
		'linear', 'logarithmic', 'exponential', 's-curve', 'constant-power',
	]);
	const [linear, logarithmic, exponential, sCurve, power] = END_FADE_SHAPE_PRESETS;
	for (const frame of [0, 25, 50, 75, 100]) {
		close(evaluateClipFadeAt(frame, 100, 100, 'in', linear.shape), frame / 100);
		close(evaluateClipFadeAt(frame, 100, 100, 'out', linear.shape), 1 - frame / 100);
	}
	const quarterSine = Math.sin(Math.PI / 8);
	close(evaluateClipFadeAt(25, 100, 100, 'in', sCurve.shape), quarterSine ** 2);
	assert.notEqual(evaluateClipFadeAt(25, 100, 100, 'in', sCurve.shape), 0.25);
	close(evaluateClipFadeAt(25, 100, 100, 'in', logarithmic.shape), quarterSine ** 0.5);
	close(evaluateClipFadeAt(25, 100, 100, 'in', exponential.shape), quarterSine ** 3);
	close(evaluateClipFadeAt(25, 100, 100, 'in', power.shape), quarterSine);
});

test('end-fade selection recognizes preset shapes and small drift while leaving custom curves unselected', () => {
	for (const preset of END_FADE_SHAPE_PRESETS) {
		assert.equal(selectedEndFadeShapePreset(preset.shape), preset.id);
		if (preset.shape !== undefined) {
			assert.equal(selectedEndFadeShapePreset(preset.shape + 5e-10), preset.id);
		}
	}
	assert.equal(selectedEndFadeShapePreset(2.1), null);
	assert.equal(selectedEndFadeShapePreset(2 + 2e-9), null);
	assert.equal(selectedEndFadeShapePreset(Number.NaN), null);
});

test('crossfade selection requires both matching edges and treats absent shapes as constant power', () => {
	assert.equal(selectedCrossfadeShapePreset(undefined, undefined), 'constant-power');
	assert.equal(selectedCrossfadeShapePreset(undefined, 1), 'constant-power');
	assert.equal(selectedCrossfadeShapePreset(1, undefined), 'constant-power');
	for (const preset of CROSSFADE_SHAPE_PRESETS) {
		assert.equal(selectedCrossfadeShapePreset(preset.shape, preset.shape), preset.id);
		assert.equal(selectedCrossfadeShapePreset(preset.shape - 5e-10, preset.shape + 5e-10), preset.id);
	}
	assert.equal(selectedCrossfadeShapePreset(1, 2), null);
	assert.equal(selectedCrossfadeShapePreset(undefined, 2), null);
	assert.equal(selectedCrossfadeShapePreset(0.37, 3.41), null);
	assert.equal(selectedCrossfadeShapePreset(2 + 2e-9, 2), null);
	assert.equal(selectedCrossfadeShapePreset(Number.NaN, 1), null);
});
