/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainDialogDragOffset } from '../src/common/editor/ui/dialog-drag-bounds.ts';

test('dragging a title toward any window edge retains the entire title and close control', () => {
	const header = { left: 300, right: 920, top: 300, bottom: 327 };
	const viewport = { width: 1280, height: 720 };
	for (const requested of [{ x: -1000, y: -1000 }, { x: 1000, y: 1000 }]) {
		const offset = constrainDialogDragOffset(requested, { x: 0, y: 0 }, header, viewport);
		assert.ok(header.left + offset.x >= 8);
		assert.ok(header.right + offset.x <= viewport.width - 8);
		assert.ok(header.top + offset.y >= 8);
		assert.ok(header.bottom + offset.y <= viewport.height - 8);
	}
	assert.deepEqual(constrainDialogDragOffset({ x: 20, y: -30 }, { x: 0, y: 0 }, header, viewport),
		{ x: 20, y: -30 });
});

test('the next drag retains a title that was previously moved', () => {
	const offset = constrainDialogDragOffset({ x: -1000, y: -1000 }, { x: -100, y: 60 },
		{ left: 200, right: 820, top: 360, bottom: 387 }, { width: 1280, height: 720 });
	assert.equal(200 + offset.x - (-100), 8);
	assert.equal(360 + offset.y - 60, 8);
});
