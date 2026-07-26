/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compatibleMediaTrack,
	dbToLinear,
	linearToDb,
	meterPercent,
	normalizeSpectrogramScale,
	normalizeWaveformRulerState,
	secondsDeltaToFrames,
	spectrogramFrequencyAtFraction,
	spectrogramFrequencyFraction,
	trackVisualHeight,
} from '../src/common/editor/ui/timeline/geometry.ts';

test('timeline frequency geometry round-trips every supported ruler scale', () => {
	for (const scale of ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'] as const) {
		const fraction = spectrogramFrequencyFraction(4_000, scale, 20, 20_000);
		const frequency = spectrogramFrequencyAtFraction(fraction, scale, 20, 20_000);
		assert.ok(Math.abs(frequency - 4_000) < 0.01, `${scale}: ${frequency}`);
	}
	assert.equal(normalizeSpectrogramScale('log'), 'logarithmic');
	assert.equal(normalizeSpectrogramScale('unsupported'), 'mel');
});

test('timeline frame, meter, and height geometry keeps existing bounds', () => {
	assert.equal(secondsDeltaToFrames(-0.5, 48_000), -24_000);
	assert.equal(secondsDeltaToFrames(Number.NaN, 48_000), 0);
	assert.ok(Math.abs(dbToLinear(linearToDb(0.5)) - 0.5) < 1e-12);
	assert.equal(meterPercent(-60), 0);
	assert.equal(meterPercent(0), 100);
	assert.equal(trackVisualHeight({ type: 'audio', height: 80 }, true), 104);
	assert.equal(trackVisualHeight({ type: 'video', height: 80 }, true), 80);
	assert.deepEqual(normalizeWaveformRulerState({ format: 'linear-amp', zoom: 2 }), {
		format: 'linear-db', zoom: 2,
	});
});

test('compatible media tracks resolve linked A/V lanes without crossing groups', () => {
	const project = { tracks: [
		{ id: 'video', type: 'video', laneGroupId: 'pair', clipIds: [] },
		{ id: 'audio', type: 'audio', laneGroupId: 'pair', clipIds: [] },
		{ id: 'other', type: 'audio', laneGroupId: null, clipIds: [] },
	] };
	assert.equal(compatibleMediaTrack(project, 'video', 'audio')?.id, 'audio');
	assert.equal(compatibleMediaTrack(project, 'other', 'video'), null);
	assert.equal(compatibleMediaTrack(project, 'missing', 'audio'), null);
});
