/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectClipsToViewport } from '../src/common/editor/design-system-adapters/timeline.ts';
import { createTimelineViewportClipIndex } from '../src/common/editor/design-system-adapters/timeline-viewport-index.ts';

test('indexed viewport projections preserve input order, long overlaps, and overscan boundaries', () => {
	const clips = [
		{ id: 'late', timelineStartFrame: 240, durationFrames: 20 },
		{ id: 'long', timelineStartFrame: 0, durationFrames: 1_000 },
		{ id: 'edge-before', timelineStartFrame: 0, durationFrames: 100 },
		{ id: 'visible', timelineStartFrame: 200, durationFrames: 40 },
		{ id: 'edge-after', timelineStartFrame: 400, durationFrames: 50 },
		{ id: 'early', timelineStartFrame: 110, durationFrames: 40 },
	];
	const index = createTimelineViewportClipIndex(clips);
	const options = { viewportStartFrame: 200, viewportDurationFrames: 100, sampleRate: 100 };
	assert.deepEqual(projectClipsToViewport(clips, options, index), projectClipsToViewport(clips, options));
	assert.deepEqual(index.query(100, 400).map(({ id }) => id), ['late', 'long', 'visible', 'early']);
	assert.deepEqual(index.query(1_000, 1_100), []);
	assert.deepEqual(createTimelineViewportClipIndex([]).query(0, 10), []);
});

test('indexed viewport queries agree with a scan throughout an unordered overlapping session', () => {
	const clips = Array.from({ length: 400 }, (_, ordinal) => ({
		id: String(ordinal),
		timelineStartFrame: ordinal * 719 % 10_000,
		durationFrames: 1 + ordinal * 317 % 3_000,
	}));
	const index = createTimelineViewportClipIndex(clips);
	for (let frame = 0; frame < 15_000; frame += 137) {
		const options = { viewportStartFrame: frame, viewportDurationFrames: 100, sampleRate: 44_100 };
		assert.deepEqual(projectClipsToViewport(clips, options, index), projectClipsToViewport(clips, options));
	}
});

test('indexed scrolling reads only intersecting clip geometry after the snapshot is indexed', () => {
	let geometryReads = 0;
	const clips = Array.from({ length: 10_000 }, (_, ordinal) => ({
		id: String(ordinal),
		get timelineStartFrame() { geometryReads += 1; return ordinal * 1_000; },
		get durationFrames() { geometryReads += 1; return 500; },
	}));
	const index = createTimelineViewportClipIndex(clips);
	geometryReads = 0;
	for (let ordinal = 5_000; ordinal < 5_010; ordinal += 1) {
		const projection = projectClipsToViewport(clips, {
			viewportStartFrame: ordinal * 1_000,
			viewportDurationFrames: 100,
		}, index);
		assert.equal(projection.clips.length, 1);
	}
	assert.ok(geometryReads < 100, `${geometryReads} reads should depend on visible clips, not all 10,000 clips`);
});

test('indexes validate offscreen geometry and require the same immutable clip snapshot', () => {
	assert.throws(() => createTimelineViewportClipIndex([
		{ timelineStartFrame: 1_000_000, durationFrames: 0 },
	]), /clip.durationFrames/u);
	assert.throws(() => createTimelineViewportClipIndex([
		{ timelineStartFrame: Number.MAX_SAFE_INTEGER, durationFrames: 1 },
	]), /safe frame range/u);
	const clips = [{ timelineStartFrame: 0, durationFrames: 10 }];
	const index = createTimelineViewportClipIndex(clips);
	assert.throws(() => projectClipsToViewport([...clips], { viewportDurationFrames: 1 }, index), /snapshot/u);
	const edited = [{ timelineStartFrame: 1_000, durationFrames: 10 }];
	assert.equal(projectClipsToViewport(edited, { viewportDurationFrames: 1 }, createTimelineViewportClipIndex(edited)).clips.length, 0);
});
