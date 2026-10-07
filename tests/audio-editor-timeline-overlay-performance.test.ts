/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipFadeGeometryReader, applyLoopTrimStyle } from '../src/common/editor/ui/timeline/clip-overlay-presentation.ts';

void test('fade geometry only visits selected or faded audio clips and retains expensive curves on selection changes', () => {
	let shapeReads = 0;
	const plain = Array.from({ length: 2000 }, (_, index) => ({ id: `plain-${index}`, kind: 'audio', timelineStartFrame: index * 100,
		durationFrames: 100, fadeInFrames: 0, fadeOutFrames: 0, get fadeInShape(): never { throw new Error('inactive curves must not be inspected'); } }));
	const faded = { id: 'faded', kind: 'audio', timelineStartFrame: 0, durationFrames: 200, fadeInFrames: 100,
		get fadeInShape() { shapeReads++; return 1; } };
	const reader = createClipFadeGeometryReader();
	const clips = [...plain, faded];
	const first = reader(clips, new Set(), 0, 500, 100, 100);
	assert.deepEqual([...first.keys()], ['faded']);
	assert.ok(shapeReads > 0); shapeReads = 0;
	const selected = reader(clips, new Set(['plain-1']), 0, 500, 100, 100);
	assert.deepEqual([...selected.keys()], ['plain-1', 'faded']);
	assert.equal(selected.get('faded')?.geometry, first.get('faded')?.geometry);
	assert.equal(shapeReads, 0);
	assert.equal(reader(clips, new Set(), 10, 500, 100, 100).get('faded')?.geometry.left, 0);
	assert.ok(shapeReads > 0, 'viewport changes still rebuild exact clipped curves');
});

void test('loop trim placement only writes changed inline geometry and resets formerly active previews', () => {
	let writes = 0; let right = ''; let visibility = '';
	const style = { get right() { return right; }, set right(value: string) { writes++; right = value; },
		get visibility() { return visibility; }, set visibility(value: string) { writes++; visibility = value; } };
	const trim = { style } as unknown as HTMLElement;
	applyLoopTrimStyle(trim, true, 200, 0, 400, 100, 100); assert.equal(right, '200px');
	writes = 0; applyLoopTrimStyle(trim, true, 200, 0, 400, 100, 100); assert.equal(writes, 0);
	applyLoopTrimStyle(trim, false, 200, 0, 400, 100, 100); assert.equal(right, '');
	applyLoopTrimStyle(trim, true, 200, 250, 400, 100, 100); assert.equal(visibility, 'hidden');
});
