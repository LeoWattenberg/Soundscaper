/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticClipCrossfadeRanges, findPartialClipOverlaps } from '../src/common/editor/audio-clip-overlap.ts';
import { createTimelineAnnotationViewportIndex } from '../src/common/editor/ui/timeline/timeline-annotation-viewport-index.ts';
import { timelineAnnotationIsVisible } from '../src/common/editor/ui/timeline/timeline-annotation-ui-model.ts';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

void test('crossfade range preparation consumes one owned overlap analysis without a second geometry scan', () => {
	let reads = 0;
	const clips = [{ id: 'a', start: 0, duration: 100 }, { id: 'b', start: 50, duration: 100 }];
	const accessors = { id: (clip: typeof clips[number]) => clip.id, startFrame: (clip: typeof clips[number]) => { reads++; return clip.start; },
		durationFrames: (clip: typeof clips[number]) => { reads++; return clip.duration; } };
	const expected = automaticClipCrossfadeRanges(clips, accessors);
	const overlaps = findPartialClipOverlaps(clips, accessors);
	reads = 0;
	assert.deepEqual(automaticClipCrossfadeRanges(clips, accessors, undefined, overlaps), expected);
	assert.equal(reads, 0);
});

void test('annotation viewport queries preserve minimum-width regions, marker hit margins, order and retained focus', () => {
	const annotations: RuntimeTimelineAnnotationProjection[] = Array.from({ length: 10_000 }, (_, index) => ({
		id: String(index), sequenceId: 'main', kind: index % 2 ? 'marker' : 'region', anchor: 'sample', name: '', color: 'blue', batchId: null,
		opaqueExtensions: {}, coordinateDomain: 'resolved-samples', startFrame: index * 100, endFrame: index * 100 + (index % 2 ? 0 : 1),
		timelineStartFrame: index * 100, timelineEndFrame: index * 100 + (index % 2 ? 0 : 1), durationFrames: index % 2 ? 0 : 1,
	}) as RuntimeTimelineAnnotationProjection);
	const reader = createTimelineAnnotationViewportIndex(annotations);
	for (const scrollX of [-12, 0, 19.999, 1000, 20_000]) {
		const retained = ['9999'];
		const expected = annotations.filter(annotation => retained.includes(annotation.id) || timelineAnnotationIsVisible(annotation, 100, 100, scrollX, 320));
		assert.deepEqual(reader.query(100, 100, scrollX, 320, retained), expected);
	}
	let geometryReads = 0;
	for (const annotation of annotations) Object.defineProperty(annotation, 'timelineStartFrame', { get() { geometryReads++; return Number(annotation.id) * 100; } });
	assert.equal(reader.query(100, 100, 1000, 320, []).length, 4);
	assert.ok(geometryReads < 20, `exact geometry checks touch only candidates (${geometryReads}), instead of 10,000 annotations`);
	const finalMarker = { ...annotations[1]!, id: 'far-marker', positionFrame: Number.MAX_SAFE_INTEGER,
		timelineStartFrame: Number.MAX_SAFE_INTEGER, timelineEndFrame: Number.MAX_SAFE_INTEGER, durationFrames: 0 } as RuntimeTimelineAnnotationProjection;
	assert.deepEqual(createTimelineAnnotationViewportIndex([finalMarker]).query(1, 1, Number.MAX_SAFE_INTEGER, 100, []), [finalMarker],
		'a legal marker at the last safe sample never overflows the interval-index carrier');
});
