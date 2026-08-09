/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
	compareRuntimeTimelineAnnotations,
	resolveRuntimeTimelineAnnotationProjection,
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProject,
} from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';
import type { HoldTempoMap } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const TEMPO_MAP: HoldTempoMap = {
	mode: 'musical',
	events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};

test('annotation projection resolves timing, freezes transients, sorts exactly, and leaves wire order untouched', () => {
	const annotations = [
		musicalRegion('z-region', 'sequence-a', { num: 1, den: 1 }, { num: 2, den: 1 }),
		sampleMarker('b-marker', 'sequence-a', 10),
		sampleMarker('a-marker', 'sequence-a', 10),
		sampleRegion('early-region', 'sequence-a', 5, 10),
		musicalMarker('other-sequence', 'sequence-b', { num: 0, den: 1 }),
	] as const;
	const project = annotationProject(annotations);
	const persistedOrder = annotations.map(({ id }) => id);

	const projected = resolveRuntimeTimelineAnnotationsProjection(project);

	assert.deepEqual(annotations.map(({ id }) => id), persistedOrder);
	assert.deepEqual(projected.map(({ id }) => id), [
		'early-region',
		'a-marker',
		'b-marker',
		'z-region',
		'other-sequence',
	]);
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(projected.every(Object.isFrozen), true);
	assert.deepEqual(
		projected.map(({ timelineStartFrame, timelineEndFrame, durationFrames }) => (
			[timelineStartFrame, timelineEndFrame, durationFrames]
		)),
		[
			[5, 10, 5],
			[10, 10, 0],
			[10, 10, 0],
			[24_000, 48_000, 24_000],
			[0, 0, 0],
		],
	);
	assert.equal(projected[3].coordinateDomain, 'resolved-samples');
	assert.equal(Object.hasOwn(projected[3], 'resolvedStartFrame'), false);
	assert.equal(Object.hasOwn(projected[3], 'resolvedEndFrame'), false);
	assert.equal(Object.hasOwn(projected[4], 'positionFrame'), false);

	const single = resolveRuntimeTimelineAnnotationProjection(project, annotations[0]);
	assert.deepEqual(single, projected.find(({ id }) => id === 'z-region'));
});

test('the public comparator is a total order with locale-independent binary identity ties', () => {
	const project = annotationProject([
		sampleMarker('a10', 'sequence', 10),
		sampleMarker('a2', 'sequence', 10),
		sampleMarker('\u00e4', 'sequence', 10),
		sampleMarker('z', 'sequence', 10),
		sampleMarker('\u{10000}', 'sequence', 10),
		sampleMarker('\ue000', 'sequence', 10),
	]);
	const projected = project.timelineAnnotations.map((annotation) => (
		resolveRuntimeTimelineAnnotationProjection(project, annotation)
	));

	assert.deepEqual(projected.sort(compareRuntimeTimelineAnnotations).map(({ id }) => id), [
		'a10', 'a2', 'z', '\u00e4', '\u{10000}', '\ue000',
	]);
	for (const left of projected) {
		for (const right of projected) {
			const forward = Math.sign(compareRuntimeTimelineAnnotations(left, right));
			const backward = Math.sign(compareRuntimeTimelineAnnotations(right, left));
			assert.equal(forward + backward, 0);
		}
	}
});

test('projection is history-independent and rejects annotation collections beyond the wire bound', () => {
	const first = [
		sampleMarker('later', 'sequence', 20),
		sampleRegion('first', 'sequence', 0, 10),
	];
	const second = [...first].reverse();

	assert.deepEqual(
		resolveRuntimeTimelineAnnotationsProjection(annotationProject(first)),
		resolveRuntimeTimelineAnnotationsProjection(annotationProject(second)),
	);
	const overflow = Array.from({ length: 4_097 }, (_, index) => (
		sampleMarker(`annotation-${String(index)}`, 'sequence', index)
	));
	assert.throws(
		() => resolveRuntimeTimelineAnnotationsProjection(annotationProject(overflow)),
		/cannot exceed 4096 annotations/iu,
	);
});

test('collection projection groups annotations by sequence document order, never sequence ID collation', () => {
	const project = annotationProject([
		sampleMarker('lexical-first', 'a-sequence', 0),
		sampleMarker('document-first', 'z-sequence', 100),
	], TEMPO_MAP, ['z-sequence', 'a-sequence']);

	assert.deepEqual(
		resolveRuntimeTimelineAnnotationsProjection(project).map(({ id }) => id),
		['document-first', 'lexical-first'],
	);
});

test('comparator orders start, kind, shorter end, anchor, exact musical coordinates, then ID', () => {
	const annotations = [
		musicalRegion('musical-shifted', 'sequence', { num: 1, den: 1_000_000 }, { num: 1, den: 24_000 }),
		sampleRegion('sample-long', 'sequence', 0, 2),
		musicalMarker('musical-marker-later', 'sequence', { num: 1, den: 500_000 }),
		musicalRegion('musical-origin', 'sequence', { num: 0, den: 1 }, { num: 1, den: 24_000 }),
		sampleMarker('sample-marker', 'sequence', 0),
		sampleRegion('sample-short', 'sequence', 0, 1),
		musicalMarker('musical-marker-earlier', 'sequence', { num: 1, den: 1_000_000 }),
	];
	const project = annotationProject(annotations);
	const projected = annotations.map((annotation) => resolveRuntimeTimelineAnnotationProjection(project, annotation));

	assert.deepEqual(projected.sort(compareRuntimeTimelineAnnotations).map(({ id }) => id), [
		'sample-marker',
		'musical-marker-earlier',
		'musical-marker-later',
		'sample-short',
		'musical-origin',
		'musical-shifted',
		'sample-long',
	]);
});

test('maximum annotation and tempo maps project through one indexed timing pass', () => {
	const count = 4_096;
	const tempoMap: HoldTempoMap = {
		mode: 'musical',
		events: Array.from({ length: count }, (_, index) => ({
			beat: { num: index, den: 1 },
			bpm: { num: index % 2 === 0 ? 120 : 90, den: 1 },
		})),
	};
	const annotations = Array.from({ length: count }, (_, index) => (
		musicalMarker(`annotation-${String(index).padStart(4, '0')}`, 'sequence', {
			num: count - index - 1,
			den: 1,
		})
	));
	const startedAt = performance.now();
	const projected = resolveRuntimeTimelineAnnotationsProjection(annotationProject(annotations, tempoMap));
	const elapsed = performance.now() - startedAt;

	assert.equal(projected.length, count);
	assert.ok(elapsed < 750, `annotation projection took ${String(Math.round(elapsed))} ms`);
});

function annotationProject(
	timelineAnnotations: readonly TimelineAnnotationV11[],
	tempoMap: HoldTempoMap = TEMPO_MAP,
	sequenceOrder: readonly string[] = [...new Set(timelineAnnotations.map(({ sequenceId }) => sequenceId))],
): RuntimeTimelineAnnotationProject {
	return {
		sampleRate: SAMPLE_RATE,
		tempoMap,
		sequences: sequenceOrder.map((id) => ({ id })),
		timelineAnnotations,
	};
}

function common(id: string, sequenceId: string) {
	return { id, sequenceId, name: id, color: 'auto' as const, batchId: null, opaqueExtensions: {} };
}

function sampleMarker(id: string, sequenceId: string, positionFrame: number): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'marker', anchor: 'sample', positionFrame };
}

function musicalMarker(
	id: string,
	sequenceId: string,
	positionBeat: Readonly<{ num: number; den: number }>,
): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'marker', anchor: 'musical', positionBeat };
}

function sampleRegion(
	id: string,
	sequenceId: string,
	startFrame: number,
	endFrame: number,
): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'region', anchor: 'sample', startFrame, endFrame };
}

function musicalRegion(
	id: string,
	sequenceId: string,
	startBeat: Readonly<{ num: number; den: number }>,
	endBeat: Readonly<{ num: number; den: number }>,
): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'region', anchor: 'musical', startBeat, endBeat };
}
