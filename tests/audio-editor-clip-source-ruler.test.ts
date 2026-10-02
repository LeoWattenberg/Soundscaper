/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipSourceRulerTicks } from '../src/common/editor/ui/inspector/clip-source-ruler-model.ts';

const options = {
	tempoMap: { mode: 'musical' as const, events: [{ id: 'a', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }, { id: 'b', beat: { num: 8, den: 1 }, bpm: { num: 60, den: 1 } }, { id: 'c', beat: { num: 12, den: 1 }, bpm: { num: 120, den: 1 } }] },
	signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
	sampleRate: 1000, startFrame: 0, endFrame: 8000, clipStartFrame: 1000, projectStartFrame: 4000, width: 1000, global: false, beats: true,
};

test('local bars begin at the clip and use the tempo at its real project position', () => {
	const ticks = createClipSourceRulerTicks(options);
	assert.deepEqual(ticks.filter((tick) => ['1','2','3'].includes(tick.label)), [
		{ frame: 1000, label: '1' }, { frame: 5000, label: '2' }, { frame: 7000, label: '3' },
	]);
});

test('global musical labels match the main project ruler at the clip placement', () => {
	const ticks = createClipSourceRulerTicks({ ...options, global: true });
	assert.deepEqual(ticks.filter((tick) => ['3','4','5'].includes(tick.label)), [
		{ frame: 1000, label: '3' }, { frame: 5000, label: '4' }, { frame: 7000, label: '5' },
	]);
});

test('a clip starting between project beats owns an exact local bar origin', () => {
	const ticks = createClipSourceRulerTicks({ ...options, projectStartFrame: 4500 });
	assert.equal(ticks.find((tick) => tick.label === '1')?.frame, 1000);
	assert.equal(ticks.find((tick) => tick.label === '2')?.frame, 4750);
});

test('local signature changes retain their real sample instant after a partial first bar', () => {
	const ticks = createClipSourceRulerTicks({ ...options, projectStartFrame: 4500, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }, { bar: 3, numerator: 3, denominator: 4 }] } });
	assert.equal(ticks.find((tick) => tick.label === '1')?.frame, 1000);
	assert.equal(ticks.find((tick) => tick.label === '2')?.frame, 4500);
	assert.equal(ticks.find((tick) => tick.label === '3')?.frame, 6000);
});

test('source material before project zero remains visible in the global musical ruler', () => {
	const ticks = createClipSourceRulerTicks({ ...options, projectStartFrame: 0, clipStartFrame: 3000, global: true });
	assert.ok(ticks.some((tick) => tick.frame < 3000));
	assert.equal(ticks.find((tick) => tick.label === '1')?.frame, 3000);
});
