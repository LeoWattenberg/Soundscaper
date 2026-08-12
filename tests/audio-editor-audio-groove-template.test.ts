/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudioGrooveTemplate,
	normalizeAudioGrooveTemplate,
} from '../src/common/editor/audio-groove-template.ts';

test('normalizes a bounded reusable groove and applies its cycle exactly', () => {
	const groove = normalizeAudioGrooveTemplate({
		offsets: [0, { num: 1, den: 3 }],
	});
	assert.deepEqual(groove, {
		offsets: [{ num: 0, den: 1 }, { num: 1, den: 3 }],
	});
	assert.ok(Object.isFrozen(groove));
	assert.ok(Object.isFrozen(groove.offsets));
	assert.ok(groove.offsets.every(Object.isFrozen));

	const grid = { origin: 0, interval: 1 } as const;
	assert.deepEqual(applyAudioGrooveTemplate(0, grid, groove), { num: 0, den: 1 });
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove), { num: 4, den: 3 });
	assert.deepEqual(applyAudioGrooveTemplate(2, grid, groove), { num: 2, den: 1 });
	assert.deepEqual(applyAudioGrooveTemplate(3, grid, groove), { num: 10, den: 3 });
	assert.deepEqual(applyAudioGrooveTemplate(-1, grid, groove), { num: -2, den: 3 });
});

test('groove strength has exact zero, one, and monotonic intermediate semantics', () => {
	const groove = normalizeAudioGrooveTemplate({ offsets: [0, { num: 1, den: 3 }] });
	const grid = { origin: 0, interval: 1 } as const;
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove, 0), { num: 1, den: 1 });
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove, { num: 1, den: 2 }), { num: 7, den: 6 });
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove, 1), { num: 4, den: 3 });
});

test('rejects open, unbounded, and position-inverting groove templates', () => {
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: [0, 0], extra: true }), /unsupported field/iu);
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: [0, -2] }), /strictly increasing/iu);
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: [0, 2] }), /cycle boundary/iu);
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: [] }), /1 through 128/iu);
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: Array.from({ length: 129 }, () => 0) }), /1 through 128/iu);
	assert.throws(() => applyAudioGrooveTemplate(1, { origin: 0, interval: 0 }, { offsets: [0] }), /interval.*positive/iu);
	assert.throws(() => applyAudioGrooveTemplate(1, { origin: 0, interval: 1 }, { offsets: [0] }, 1.1), /strength/iu);

	let getterRead = false;
	const accessor = Object.defineProperty({}, 'offsets', {
		enumerable: true,
		get() { getterRead = true; return [0]; },
	});
	assert.throws(() => normalizeAudioGrooveTemplate(accessor), /data property/iu);
	assert.equal(getterRead, false);
});
