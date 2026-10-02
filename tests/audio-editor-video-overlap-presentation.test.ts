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

test('dense offscreen image overlaps retain bounded preparation and project every visible pair', () => {
	const images = Array.from({ length: 250 }, (_, index) => ({
		...clip(`image-${String(index).padStart(3, '0')}`, 10_000, 100), kind: 'image',
	}));
	const analysis = analyzeVideoClipOverlaps([
		...images, clip('left', 0, 150), clip('right', 100, 150),
	]);
	assert.ok(analysis.overlaps.length <= 504, 'offscreen dense pairs must not be retained quadratically');
	assert.equal(analysis.invalid, true);
	assert.equal(analysis.invalidClipIds.size, images.length);
	assert.equal(analysis.invalidClipIds.has('left'), false);
	assert.equal(analysis.invalidClipIds.has('right'), false);
	const offscreen = projectVideoOverlapPresentation(analysis, 1_000, 2_000, 100, 100);
	assert.deepEqual(offscreen.overlays, []);
	const valid = projectVideoOverlapPresentation(analysis, 120, 220, 100, 100);
	assert.deepEqual(valid.overlays.map(({ id, width, valid }) => ({ id, width, valid })), [
		{ id: 'left:right:100:150', width: 30, valid: true },
	]);
	const dense = projectVideoOverlapPresentation(analysis, 10_020, 10_030, 100, 100);
	assert.equal(dense.overlays.length, images.length * (images.length - 1) / 2);
	assert.deepEqual(dense.overlays[0], {
		id: 'image-000:image-001:10000:10100', left: 12, width: 10, valid: false,
		label: 'Invalid video overlap between IMAGE-000 and IMAGE-001',
	});
	assert.equal(dense.overlays.at(-1)?.id, 'image-248:image-249:10000:10100');
});

test('swept invalid clip IDs and dense projections agree with exhaustive overlap geometry', () => {
	let seed = 123;
	const next = () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed; };
	for (let sample = 0; sample < 20; sample += 1) {
		const clips = Array.from({ length: 80 }, (_, index) => clip(String(index), next() % 500, next() % 150 + 1))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
		const expected = [];
		const invalidIds = new Set<string>();
		for (let leftIndex = 0; leftIndex < clips.length; leftIndex += 1) {
			const left = clips[leftIndex]!;
			for (let rightIndex = leftIndex + 1; rightIndex < clips.length; rightIndex += 1) {
				const right = clips[rightIndex]!;
				const start = Math.max(left.timelineStartFrame, right.timelineStartFrame);
				const end = Math.min(left.timelineStartFrame + left.durationFrames, right.timelineStartFrame + right.durationFrames);
				if (start >= end) continue;
				const valid = left.timelineStartFrame < right.timelineStartFrame
					&& left.timelineStartFrame + left.durationFrames < right.timelineStartFrame + right.durationFrames
					&& !clips.some((third, index) => index !== leftIndex && index !== rightIndex
						&& third.timelineStartFrame < end && third.timelineStartFrame + third.durationFrames > start);
				if (!valid) { invalidIds.add(left.id); invalidIds.add(right.id); }
				if (start < 300 && end > 200) expected.push({ id: `${left.id}:${right.id}:${start}:${end}`, valid });
			}
		}
		const analysis = analyzeVideoClipOverlaps(clips);
		assert.deepEqual([...analysis.invalidClipIds].sort(), [...invalidIds].sort());
		assert.deepEqual(projectVideoOverlapPresentation(analysis, 200, 300, 100, 100).overlays
			.map(({ id, valid }) => ({ id, valid })), expected);
	}
});
