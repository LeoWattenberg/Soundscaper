/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelViewportIndex } from '../src/common/editor/ui/timeline/label-viewport-model.ts';

test('label windows retain overlapping regions, flag overflow, stacking and active labels', () => {
	const labels = [
		{ id: 'active', startFrame: 30_000, endFrame: 30_000 },
		{ id: 'long', startFrame: 0, endFrame: 20_000 },
		{ id: 'flag', startFrame: 950, endFrame: 950 },
		{ id: 'near', startFrame: 1_020, endFrame: 1_030 },
		{ id: 'outside', startFrame: 500, endFrame: 500 },
	];
	assert.deepEqual(createLabelViewportIndex(labels).query(1_000, 1_100, 100, ['active', null]).map(label => label.id),
		['active', 'long', 'flag', 'near']);
});

test('scrolling a dense label index never rereads offscreen marker geometry', () => {
	let reads = 0;
	const labels = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index),
		get startFrame() { reads += 1; return index * 100; },
		get endFrame() { reads += 1; return index * 100 + 10; },
	}));
	const index = createLabelViewportIndex(labels);
	reads = 0;
	assert.equal(index.query(2_000, 2_100, 1, []).length, 2);
	assert.equal(reads, 0);
});
