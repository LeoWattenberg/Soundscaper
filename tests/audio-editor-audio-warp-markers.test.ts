/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	addAudioWarpMarker,
	deleteAudioWarpMarker,
	moveAudioWarpMarker,
} from '../src/common/editor/controller/audio-warp-marker-editor.ts';

const MAP = Object.freeze({
	feature: 'audio-warp' as const,
	points: [
		{ outer: 0, source: 100, mode: 'forward' as const },
		{ outer: 50, source: 200, mode: 'forward' as const },
		{ outer: 100, source: 300, mode: 'forward' as const },
	],
});

test('marker CRUD preserves exact rational coordinates and protected endpoints', () => {
	const added = addAudioWarpMarker(MAP, {
		outer: { num: 75, den: 1 }, source: { num: 501, den: 2 },
	});
	assert.deepEqual(added.points.map(({ outer, source }) => ({ outer, source })), [
		{ outer: { num: 0, den: 1 }, source: { num: 100, den: 1 } },
		{ outer: { num: 50, den: 1 }, source: { num: 200, den: 1 } },
		{ outer: { num: 75, den: 1 }, source: { num: 501, den: 2 } },
		{ outer: { num: 100, den: 1 }, source: { num: 300, den: 1 } },
	]);
});

test('marker add, move, and delete reject inversions, endpoint edits, extras, and stale indices', () => {
	assert.throws(() => addAudioWarpMarker(MAP, { outer: 50, source: 250 }), /strictly increasing/iu);
	assert.throws(() => addAudioWarpMarker(MAP, { outer: 75, source: 250, extra: true } as never), /unsupported field/iu);
	assert.throws(() => moveAudioWarpMarker(MAP, 0, { outer: 10, source: 110 }), /interior/iu);
	assert.throws(() => moveAudioWarpMarker(MAP, 2, { outer: 90, source: 290 }), /interior/iu);
	assert.throws(() => moveAudioWarpMarker(MAP, 1, { outer: 90, source: 301 }), /strictly increasing/iu);
	assert.throws(() => deleteAudioWarpMarker(MAP, 0), /interior/iu);
	assert.throws(() => deleteAudioWarpMarker(MAP, 3), /interior/iu);

	const moved = moveAudioWarpMarker(MAP, 1, { outer: { num: 101, den: 2 }, source: 201 });
	assert.deepEqual(moved.points[1], {
		outer: { num: 101, den: 2 }, source: { num: 201, den: 1 }, mode: 'forward',
	});
	assert.deepEqual(deleteAudioWarpMarker(moved, 1).points, [
		{ outer: { num: 0, den: 1 }, source: { num: 100, den: 1 }, mode: 'forward' },
		{ outer: { num: 100, den: 1 }, source: { num: 300, den: 1 }, mode: 'forward' },
	]);
});
