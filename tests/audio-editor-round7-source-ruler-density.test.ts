/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipSourceRulerTicks } from '../src/common/editor/ui/inspector/clip-source-ruler-model.ts';
import type { ClipSourceRulerTickOptions } from '../src/common/editor/ui/inspector/clip-source-ruler-model.ts';

const options: ClipSourceRulerTickOptions = {
	tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
	sampleRate: 48_000, startFrame: 0, endFrame: 120 * 48_000,
	clipStartFrame: 0, projectStartFrame: 0, width: 600, global: false, beats: true,
};

test('ordinary constant-tempo source bars retain readable labels and exact origin', () => {
	const ticks = createClipSourceRulerTicks(options);
	assert.equal(ticks[0]?.label, '1');
	assert.equal(ticks[0]?.frame, 0);
	assert.ok(ticks.length > 1);
	for (let index = 1; index < ticks.length; index += 1) {
		assert.ok((ticks[index]!.frame - ticks[index - 1]!.frame) / options.endFrame * options.width >= 64);
	}
});

test('source bar labels remain readable through an ordinary authored tempo change', () => {
	const ticks = createClipSourceRulerTicks({ ...options, tempoMap: { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 960, den: 1 } },
		{ beat: { num: 40, den: 1 }, bpm: { num: 30, den: 1 } },
	] } });
	assert.equal(ticks[0]?.label, '1');
	assert.ok(ticks.length > 1);
	for (let index = 1; index < ticks.length; index += 1) {
		const distance = (ticks[index]!.frame - ticks[index - 1]!.frame) / options.endFrame * options.width;
		assert.ok(distance >= 64, `source labels overlap at ${String(distance)} pixels`);
	}
});
