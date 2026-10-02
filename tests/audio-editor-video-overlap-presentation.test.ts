/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeVideoClipOverlaps, projectVideoOverlapPresentation } from '../src/common/editor/ui/timeline/video-overlap-presentation.ts';

function clip(id: string, start: number, duration: number) {
	return { id, title: id.toUpperCase(), kind: 'video', timelineStartFrame: start, durationFrames: duration };
}

test('video overlap projections retain proper transitions, input-independent ordering, and visible geometry', () => {
	const analysis = analyzeVideoClipOverlaps([clip('c', 300, 150), clip('b', 100, 150), clip('a', 0, 150)]);
	const projected = projectVideoOverlapPresentation(analysis, 120, 220, 100, 100);
	assert.equal(projected.invalid, false);
	assert.deepEqual([...projected.invalidClipIds], []);
	assert.deepEqual(projected.overlays.map(({ id, width, valid, label }) => ({ id, width, valid, label })), [{
		id: 'a:b:100:150', width: 30, valid: true, label: 'Automatic crossfade between A and B',
	}]);
	assert.equal(projectVideoOverlapPresentation(analysis, 150, 200, 100, 100).overlays.length, 0);
});

test('video overlap validity sees a third clip before or after the intersecting pair', () => {
	for (const third of [clip('third', 10, 200), clip('third', 125, 30)]) {
		const analysis = analyzeVideoClipOverlaps([clip('left', 0, 150), clip('right', 100, 150), third]);
		assert.equal(analysis.invalid, true);
		const overlap = projectVideoOverlapPresentation(analysis, 0, 300, 100, 100).overlays
			.find(({ id }) => id.startsWith('left:right:'));
		assert.equal(overlap?.valid, false);
		assert.equal(analysis.invalidClipIds.has('left'), true);
		assert.equal(analysis.invalidClipIds.has('right'), true);
	}
	const boundary = analyzeVideoClipOverlaps([
		clip('left', 0, 150), clip('right', 100, 150), clip('third', 150, 100),
	]);
	assert.equal(projectVideoOverlapPresentation(boundary, 0, 300, 100, 100).overlays[0]?.valid, true,
		'a third clip starting at the overlap end does not cover that overlap');
});

test('invalid offscreen overlaps remain flagged when visible overlays contain none', () => {
	const analysis = analyzeVideoClipOverlaps([clip('outer', 0, 500), clip('inner', 100, 100)]);
	const projected = projectVideoOverlapPresentation(analysis, 1_000, 2_000, 100, 100);
	assert.equal(projected.invalid, true);
	assert.deepEqual([...projected.invalidClipIds], ['outer', 'inner']);
	assert.deepEqual(projected.overlays, []);
});

test('video overlap scroll projections read no authored clip geometry after analysis', () => {
	let geometryReads = 0;
	const clips = Array.from({ length: 2_000 }, (_, index) => ({
		id: String(index), kind: 'video',
		get timelineStartFrame() { geometryReads += 1; return index * 100; },
		get durationFrames() { geometryReads += 1; return 150; },
	}));
	const analysis = analyzeVideoClipOverlaps(clips);
	geometryReads = 0;
	for (let frame = 100_000; frame < 101_000; frame += 100) {
		assert.equal(projectVideoOverlapPresentation(analysis, frame, frame + 500, 100, 100).overlays.length, 5);
	}
	assert.equal(geometryReads, 0);
});
