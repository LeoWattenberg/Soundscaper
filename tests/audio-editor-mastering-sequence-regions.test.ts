/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import {
	masteringSequenceRegionViews,
	validateProjectMasteringSequence,
} from '../src/common/editor/mastering-sequence-regions.ts';
import type { RuntimeTimelineAnnotationProject } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';

const common = (id: string, sequenceId = 'main') => ({
	id, sequenceId, name: `Piece ${id}`, color: 'auto' as const, batchId: null, opaqueExtensions: {},
});

const sampleRegion = (id: string, startFrame: number, endFrame: number, sequenceId = 'main') => ({
	...common(id, sequenceId), kind: 'region' as const, anchor: 'sample' as const, startFrame, endFrame,
});

/** Anchored in beats, so only the tempo map can say where it lands in frames. */
const musicalRegion = (id: string, startBeat: number, endBeat: number) => ({
	...common(id), kind: 'region' as const, anchor: 'musical' as const,
	startBeat: { num: startBeat, den: 1 }, endBeat: { num: endBeat, den: 1 },
});

const marker = (id: string, positionFrame: number) => ({
	...common(id), kind: 'marker' as const, anchor: 'sample' as const, positionFrame,
});

function project(annotations: readonly unknown[]): RuntimeTimelineAnnotationProject {
	return {
		sampleRate: 48_000,
		// 120 bpm: one beat is half a second, so 24,000 frames.
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sequences: [{ id: 'main' }, { id: 'other' }],
		timelineAnnotations: annotations as readonly TimelineAnnotationV11[],
	};
}

test('regions become views carrying identity, extent and name', () => {
	const views = masteringSequenceRegionViews(project([
		sampleRegion('a', 0, 480_000), sampleRegion('b', 500_000, 960_000),
	]));
	assert.deepEqual(views, [
		{ id: 'a', sequenceId: 'main', name: 'Piece a', startFrame: 0, endFrame: 480_000 },
		{ id: 'b', sequenceId: 'main', name: 'Piece b', startFrame: 500_000, endFrame: 960_000 },
	]);
});

test('a musically anchored region is resolved by the project tempo map, not re-derived here', () => {
	// The reason this module exists: a sequence must never answer "where is this
	// region" itself, because at 120 bpm only the tempo map knows a beat is
	// 24,000 frames — and a second answer would drift from the first.
	const [view] = masteringSequenceRegionViews(project([musicalRegion('m', 4, 12)]));
	assert.equal(view.startFrame, 96_000);
	assert.equal(view.endFrame, 288_000);
});

test('markers are not regions and simply do not appear', () => {
	const views = masteringSequenceRegionViews(project([marker('m', 1_000), sampleRegion('a', 0, 480_000)]));
	assert.deepEqual(views.map(({ id }) => id), ['a']);
});

test('an entry pointing at a marker reports a missing region, with the entry intact', () => {
	const value = project([marker('m', 1_000), sampleRegion('a', 0, 480_000)]);
	const sequence = createMasteringSequenceV23({
		id: 'album', sequenceId: 'main', name: 'Album',
		entries: [{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'm' }],
	});
	const validation = validateProjectMasteringSequence(value, sequence);
	assert.equal(validation.valid, false);
	assert.equal(validation.issues[0].code, 'mastering-sequence.region-missing');
	assert.equal(validation.issues[0].entryId, 'e2');
	assert.equal(sequence.entries.length, 2, 'the authored order is untouched');
});

test('regions from another timeline sequence are visible but refused by validation', () => {
	// The views are project-wide; deciding which sequence an entry may reference
	// belongs to validation, so the two rules stay in one place each.
	const value = project([sampleRegion('a', 0, 480_000), sampleRegion('x', 0, 480_000, 'other')]);
	assert.deepEqual(masteringSequenceRegionViews(value).map(({ id }) => id), ['a', 'x']);

	const sequence = createMasteringSequenceV23({
		id: 'album', sequenceId: 'main', name: 'Album',
		entries: [{ id: 'e1', annotationId: 'x' }],
	});
	const validation = validateProjectMasteringSequence(value, sequence);
	assert.equal(validation.valid, false);
	assert.equal(validation.issues[0].code, 'mastering-sequence.region-other-sequence');
});

test('a whole sequence over real project annotations validates', () => {
	const value = project([
		sampleRegion('a', 0, 480_000), musicalRegion('m', 24, 40), sampleRegion('c', 1_000_000, 1_400_000),
	]);
	const sequence = createMasteringSequenceV23({
		id: 'album', sequenceId: 'main', name: 'Album',
		entries: [
			{ id: 'e1', annotationId: 'a', fadeOutFrames: 48_000 },
			{ id: 'e2', annotationId: 'm', gapBeforeFrames: 96_000 },
			{ id: 'e3', annotationId: 'c' },
		],
	});
	assert.deepEqual(validateProjectMasteringSequence(value, sequence).issues, []);
});

test('fades are checked against the resolved musical duration', () => {
	// Beat 24 to 40 is 16 beats, so 384,000 frames at 120 bpm. A fade past that
	// must be caught even though the region never stated a frame count.
	const value = project([musicalRegion('m', 24, 40)]);
	const tooLong = createMasteringSequenceV23({
		id: 'album', sequenceId: 'main', name: 'Album',
		entries: [{ id: 'e1', annotationId: 'm', fadeInFrames: 200_000, fadeOutFrames: 200_000 }],
	});
	assert.equal(validateProjectMasteringSequence(value, tooLong).valid, false);

	const fits = createMasteringSequenceV23({
		id: 'album', sequenceId: 'main', name: 'Album',
		entries: [{ id: 'e1', annotationId: 'm', fadeInFrames: 192_000, fadeOutFrames: 192_000 }],
	});
	assert.equal(validateProjectMasteringSequence(value, fits).valid, true);
});
