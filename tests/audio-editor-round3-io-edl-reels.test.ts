/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEdlExport, type EdlEvent } from '../src/common/editor/edl-export.ts';

function events(reels: readonly string[]): readonly EdlEvent[] {
	return reels.map((reel, index) => ({
		reel, trackKind: 'V', sourceInFrames: 0, sourceOutFrames: 25,
		recordInFrames: index * 25, recordOutFrames: (index + 1) * 25,
	}));
}

function exportedReels(reels: readonly string[]) {
	const result = createEdlExport({ title: 'Camera takes', rate: { num: 25, den: 1 }, events: events(reels) });
	return { result, names: result.text.split('\n').filter((line) => /^\d{3}\s/u.test(line))
		.map((line) => line.trim().split(/\s+/u)[1]!) };
}

test('ordinary camera takes sharing the eight-character prefix keep separate source identities', () => {
	const { result, names } = exportedReels(['camera-take-001.webm', 'camera-take-002.webm', 'camera-take-001.webm']);
	assert.notEqual(names[0], names[1]);
	assert.equal(names[0], names[2], 'a repeated use of the first take retains its allocated reel');
	assert.ok(names.every((name) => /^[A-Z0-9_]{1,8}$/u.test(name)));
	assert.ok(result.report.items.some((item) => item.code === 'edl.reel-collision-resolved'));
});

test('normal punctuation conversion cannot alias distinct take names', () => {
	const { names } = exportedReels(['CAM A', 'CAM-A']);
	assert.equal(new Set(names).size, 2);
});

test('an allocated suffix cannot consume another source existing short reel', () => {
	const reels = ['camera-take-001.webm', 'camera-take-002.webm', 'CAMERA_2'];
	const { names } = exportedReels(reels);
	assert.equal(new Set(names).size, 3);
	assert.equal(names[2], 'CAMERA_2');
	assert.deepEqual(exportedReels(reels).names, names, 'allocation is deterministic');
});
