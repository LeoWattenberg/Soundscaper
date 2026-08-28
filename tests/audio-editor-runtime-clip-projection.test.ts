/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	resolveRuntimeProjectProjection,
} from '../src/common/editor/runtime-clip-projection.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

const tempoMap = {
	mode: 'musical' as const,
	events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};

test('schema-v9 clips project to an immutable resolved sample surface without mutation', () => {
	const clip = {
		id: 'audio', kind: 'audio', sourceId: 'source', timelineStartFrame: 12,
		durationFrames: 20, sourceStartFrame: 3, sourceDurationFrames: 10,
	};
	const project = { schemaVersion: 9, sampleRate: 48_000, clips: [clip] };
	const projected = resolveRuntimeClipProjection(project, clip);
	assert.deepEqual(projected, {
		...clip,
		timelineStartFrame: 12,
		timelineEndFrame: 32,
		durationFrames: 20,
		sourceStartFrame: 3,
		sourceEndFrame: 13,
		sourceDurationFrames: 10,
		sequenceStartFrame: null,
		sequenceEndFrame: null,
		coordinateDomain: 'resolved-samples',
	});
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.hasOwn(clip, 'timelineEndFrame'), false);
});

test('musical clip boundaries resolve independently from the project origin', () => {
	const project = { schemaVersion: 10, sampleRate: 48_000, tempoMap };
	const projected = resolveRuntimeClipProjection(project, {
		id: 'musical', kind: 'audio', sourceId: 'source', anchor: 'musical',
		musicalStartBeat: { num: 3, den: 1 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 }, sourceStartFrame: 0,
		sourceDurationFrames: 48_000,
	});
	assert.equal(projected.timelineStartFrame, 72_000);
	assert.equal(projected.timelineEndFrame, 120_000);
	assert.equal(projected.durationFrames, 48_000);
});

test('frame-anchored video uses absolute sequence boundaries at fractional sample extents', () => {
	const project = {
		schemaVersion: 10,
		sampleRate: 44_100,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 24, den: 1 } }],
	};
	const projected = resolveRuntimeClipProjection(project, {
		id: 'video', kind: 'video', sourceId: 'source', sequenceId: 'main',
		sequenceStartFrame: 1, sequenceFrameCount: 1,
		sourceInFrame: 7, sourceFrameCount: 1,
	});
	assert.equal(projected.timelineStartFrame, 1_838);
	assert.equal(projected.timelineEndFrame, 3_675);
	assert.equal(projected.durationFrames, 1_837);
	assert.equal(projected.sourceStartFrame, 7);
	assert.equal(projected.sourceEndFrame, 8);
});

test('project projection replaces every consumer-facing clip while retaining persisted input', () => {
	const clip = {
		id: 'audio', kind: 'audio', sourceId: 'source', timelineStartFrame: 4,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	};
	const project = { schemaVersion: 9, sampleRate: 48_000, clips: [clip], tracks: [] };
	const projected = resolveRuntimeProjectProjection(project);
	assert.notStrictEqual(projected, project);
	assert.notStrictEqual(projected.clips, project.clips);
	assert.equal(projected.runtimeProjectionVersion, 2);
	assert.equal(projected.clips[0].timelineEndFrame, 12);
	assert.deepEqual(project, { schemaVersion: 9, sampleRate: 48_000, clips: [clip], tracks: [] });
});

test('projection rejects incomplete authority instead of falling back to persisted caches', () => {
	assert.throws(() => resolveRuntimeClipProjection(
		{ schemaVersion: 10, sampleRate: 48_000, tempoMap },
		{ id: 'bad', kind: 'audio', anchor: 'musical', musicalExtent: 'beat' },
	), /musicalStartBeat/iu);
	assert.throws(() => resolveRuntimeClipProjection(
		{ schemaVersion: 10, sampleRate: 48_000, primarySequenceId: 'missing', sequences: [] },
		{ id: 'bad', kind: 'video', sequenceStartFrame: 0, sequenceFrameCount: 1 },
	), /sequence/iu);
});

test('shared V11 projection resolves annotations in document order and brands their complete shape', () => {
	const project = createCurrentAudioEditorProject({
		now: '2026-08-09T18:00:00.000Z',
		timelineAnnotations: [{
			id: 'later', sequenceId: 'main-sequence', name: 'Later', color: 'auto', batchId: null,
			opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48_000,
		}, {
			id: 'earlier', sequenceId: 'main-sequence', name: 'Earlier', color: 'auto', batchId: null,
			opaqueExtensions: {}, kind: 'marker', anchor: 'musical', positionBeat: { num: 1, den: 1 },
		}],
	});
	const projected = resolveRuntimeProjectProjection(project);

	assert.equal(projected.runtimeProjectionVersion, 2);
	assert.equal(isRuntimeProjectProjection(projected), true);
	assert.deepEqual(projected.timelineAnnotations?.map(({ id }) => id), ['later', 'earlier']);
	assert.deepEqual(projected.timelineAnnotations?.map((annotation) => ({
		start: annotation.timelineStartFrame,
		end: annotation.timelineEndFrame,
		duration: annotation.durationFrames,
		domain: annotation.coordinateDomain,
	})), [{
		start: 48_000, end: 48_000, duration: 0, domain: 'resolved-samples',
	}, {
		start: 24_000, end: 24_000, duration: 0, domain: 'resolved-samples',
	}]);
	assert.equal(Object.hasOwn(project.timelineAnnotations[0]!, 'timelineStartFrame'), false);

	const derived = structuredClone(projected);
	const poisoned = derived.timelineAnnotations?.[0] as unknown as Record<string, unknown>;
	poisoned.durationFrames = 1;
	assert.throws(
		() => brandRuntimeProjectProjection(derived),
		/resolved timeline annotations/iu,
	);
});

test('timeline annotation projection follows explicit capability for a family-qualified v1 project', () => {
	const foundation = createCurrentAudioEditorProject({
		now: '2026-08-28T00:00:00.000Z',
		timelineAnnotations: [{
			id: 'v1-marker', sequenceId: 'main-sequence', name: 'V1 marker', color: 'auto', batchId: null,
			opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 24_000,
		}],
	});
	const project = Object.freeze({
		...foundation,
		schemaFamily: 'framescaper',
		schemaVersion: 1,
	});
	const projected = resolveRuntimeProjectProjection(project);

	assert.equal(isRuntimeProjectProjection(projected), true);
	assert.equal(projected.schemaFamily, 'framescaper');
	assert.equal(projected.schemaVersion, 1);
	assert.deepEqual(projected.timelineAnnotations?.map((annotation) => ({
		id: annotation.id,
		start: annotation.timelineStartFrame,
		domain: annotation.coordinateDomain,
	})), [{ id: 'v1-marker', start: 24_000, domain: 'resolved-samples' }]);
});
