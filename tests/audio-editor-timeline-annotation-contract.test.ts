/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS,
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationV11,
	createTimelineAnnotationsV11,
	validateTimelineAnnotationV11,
	validateTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from '../src/common/editor/timeline-annotation.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from '../src/common/editor/project-v10-foundation-validation.ts';
import type { HoldTempoMap } from '../src/common/editor/timeline-time.ts';

const TEMPO_MAP: HoldTempoMap = {
	mode: 'musical',
	events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};
const TEMPORAL_CONTEXT = { tempoMap: TEMPO_MAP, sampleRate: 48_000 };
const COLLECTION_CONTEXT = { ...TEMPORAL_CONTEXT, sequenceIds: ['main', 'alternate'] };

const COMMON = {
	id: 'annotation-1',
	sequenceId: 'main',
	name: 'Opening cue',
	color: 'violet' as const,
	batchId: null,
	opaqueExtensions: {},
};

function sampleMarker(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return { ...COMMON, kind: 'marker', anchor: 'sample', positionFrame: 0, ...overrides };
}

function musicalMarker(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		...COMMON,
		id: 'annotation-2',
		kind: 'marker',
		anchor: 'musical',
		positionBeat: { num: 3, den: 2 },
		...overrides,
	};
}

function sampleRegion(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		...COMMON,
		id: 'annotation-3',
		kind: 'region',
		anchor: 'sample',
		startFrame: 24_000,
		endFrame: 48_000,
		...overrides,
	};
}

function musicalRegion(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		...COMMON,
		id: 'annotation-4',
		kind: 'region',
		anchor: 'musical',
		startBeat: { num: 2, den: 1 },
		endBeat: { num: 3, den: 1 },
		...overrides,
	};
}

test('timeline annotations expose all four closed authoritative wire variants', () => {
	const values = [sampleMarker(), musicalMarker(), sampleRegion(), musicalRegion()];
	assert.deepEqual(values.map((value) => createTimelineAnnotationV11(value, TEMPORAL_CONTEXT)), values);
	for (const value of values) assert.equal(validateTimelineAnnotationV11(value, TEMPORAL_CONTEXT), true);

	for (const value of [
		sampleMarker({ positionBeat: { num: 0, den: 1 } }),
		musicalMarker({ positionFrame: 0 }),
		sampleRegion({ startBeat: { num: 0, den: 1 }, endBeat: { num: 1, den: 1 } }),
		musicalRegion({ startFrame: 0, endFrame: 1 }),
		musicalMarker({ timelineStartFrame: 36_000 }),
		musicalRegion({ durationFrames: 24_000 }),
		sampleMarker({ caption: 'not an annotation field' }),
	]) {
		assert.throws(
			() => validateTimelineAnnotationV11(value, TEMPORAL_CONTEXT),
			/unsupported field/iu,
		);
	}
	assert.throws(
		() => validateTimelineAnnotationV11({ ...COMMON, kind: 'point', anchor: 'sample', positionFrame: 0 }, TEMPORAL_CONTEXT),
		/kind/iu,
	);
	assert.throws(
		() => validateTimelineAnnotationV11({ ...COMMON, kind: 'marker', anchor: 'time', positionFrame: 0 }, TEMPORAL_CONTEXT),
		/anchor/iu,
	);
	const hidden = sampleMarker();
	Object.defineProperty(hidden, 'caption', { value: 'hidden field', enumerable: false });
	const symbolic = sampleMarker() as Record<PropertyKey, unknown>;
	symbolic[Symbol('caption')] = 'symbol field';
	for (const value of [hidden, symbolic]) {
		assert.throws(
			() => validateTimelineAnnotationV11(value, TEMPORAL_CONTEXT),
			/unsupported field|own enumerable data/iu,
		);
	}
});

test('annotation collection factories retain document order and clone opaque extensions', () => {
	const extension = { riffCue: { id: 17, note: 'Imported note' } };
	const input = [
		musicalRegion({ opaqueExtensions: extension }),
		sampleMarker(),
		musicalMarker(),
		sampleRegion(),
	];
	const result = createTimelineAnnotationsV11(input, COLLECTION_CONTEXT);
	assert.deepEqual(result.map(({ id }) => id), ['annotation-4', 'annotation-1', 'annotation-2', 'annotation-3']);
	assert.deepEqual(result[0].opaqueExtensions, extension);
	assert.notEqual(result[0].opaqueExtensions, extension);
	assert.notEqual((result[0].opaqueExtensions as { riffCue: unknown }).riffCue, extension.riffCue);
	extension.riffCue.note = 'Changed outside the annotation';
	assert.deepEqual(result[0].opaqueExtensions, { riffCue: { id: 17, note: 'Imported note' } });
	assert.equal(validateTimelineAnnotationsV11(result, COLLECTION_CONTEXT), true);
});

test('annotation collection validation bounds count, identity, sequence ownership, and batches', () => {
	assert.equal(AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations, 4_096);
	const maximum = Array.from({ length: 4_096 }, (_, index) => sampleMarker({
		id: `annotation-${String(index)}`,
		positionFrame: index,
	}));
	assert.equal(validateTimelineAnnotationsV11(maximum, COLLECTION_CONTEXT), true);
	assert.throws(
		() => validateTimelineAnnotationsV11([...maximum, sampleMarker({ id: 'overflow' })], COLLECTION_CONTEXT),
		/4,096|4096|maximum/iu,
	);
	assert.throws(
		() => validateTimelineAnnotationsV11([sampleMarker(), sampleRegion({ id: COMMON.id })], COLLECTION_CONTEXT),
		/duplicate.*annotation-1/iu,
	);
	assert.throws(
		() => validateTimelineAnnotationsV11([sampleMarker({ sequenceId: 'missing' })], COLLECTION_CONTEXT),
		/missing.*sequence|sequence.*missing/iu,
	);
	assert.equal(validateTimelineAnnotationsV11([
		sampleMarker({ batchId: 'batch-a' }),
		musicalRegion({ batchId: 'batch-a' }),
	], COLLECTION_CONTEXT), true, 'a batch may mix kinds and coordinate domains');
	assert.throws(
		() => validateTimelineAnnotationsV11([
			sampleMarker({ batchId: 'batch-a' }),
			musicalRegion({ sequenceId: 'alternate', batchId: 'batch-a' }),
		], COLLECTION_CONTEXT),
		/batch-a.*sequence|batch.*one sequence/iu,
	);
	assert.equal(validateTimelineAnnotationsV11([
		sampleMarker({ batchId: 'singleton' }),
	], COLLECTION_CONTEXT), true, 'singleton batches remain valid');
});

test('annotation text, IDs, colors, and extensions use bounded canonical wire values', () => {
	assert.deepEqual(AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS, [
		'auto', 'blue', 'violet', 'magenta', 'teal', 'cyan', 'green', 'orange', 'red', 'yellow',
	]);
	for (const color of AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS) {
		assert.equal(validateTimelineAnnotationV11(sampleMarker({ color }), TEMPORAL_CONTEXT), true);
	}
	assert.equal(validateTimelineAnnotationV11(sampleMarker({ name: '' }), TEMPORAL_CONTEXT), true);
	assert.equal(validateTimelineAnnotationV11(sampleMarker({ name: '音楽 🎵' }), TEMPORAL_CONTEXT), true);

	for (const [field, value] of [
		['id', ''],
		['id', ' annotation '],
		['id', 'x'.repeat(257)],
		['sequenceId', 'main\n'],
		['batchId', 'batch\u200bhidden'],
		['name', 'line one\nline two'],
		['name', `control${String.fromCodePoint(7)}`],
		['name', `format\u200bcharacter`],
		['name', 'x'.repeat(4_097)],
	] as const) {
		assert.throws(
			() => validateTimelineAnnotationV11(sampleMarker({ [field]: value }), TEMPORAL_CONTEXT),
			/canonical|control|format|length|maximum|single.line|non-empty/iu,
		);
	}
	assert.throws(
		() => validateTimelineAnnotationV11(sampleMarker({ color: 'chartreuse' }), TEMPORAL_CONTEXT),
		/color/iu,
	);
	for (const opaqueExtensions of [null, [], 'extension']) {
		assert.throws(
			() => validateTimelineAnnotationV11(sampleMarker({ opaqueExtensions }), TEMPORAL_CONTEXT),
			/opaqueExtensions.*object/iu,
		);
	}
	for (const opaqueExtensions of [
		{ nested: { value: 1n } },
		{ nested: new Map([['lossy', true]]) },
	]) {
		assert.throws(
			() => createTimelineAnnotationV11(sampleMarker({ opaqueExtensions }), TEMPORAL_CONTEXT),
			/opaqueExtensions|JSON.serializable|plain object|scalar/iu,
		);
		assert.throws(
			() => validateTimelineAnnotationV11(sampleMarker({ opaqueExtensions }), TEMPORAL_CONTEXT),
			/opaqueExtensions|JSON.serializable|plain object|scalar/iu,
		);
	}
});

test('musical factories canonicalize rational inputs while wire validation requires canonical nonnegative rationals', () => {
	assert.equal(AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR, Number.MAX_SAFE_INTEGER);
	assert.equal(validateTimelineAnnotationV11(musicalMarker({
		positionBeat: { num: 1, den: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR },
	}), TEMPORAL_CONTEXT), true);
	assert.throws(
		() => validateTimelineAnnotationV11(musicalMarker({
			positionBeat: { num: 1, den: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR + 1 },
		}), TEMPORAL_CONTEXT),
		/safe integer|denominator bound/iu,
	);
	assert.deepEqual(
		createTimelineAnnotationV11(musicalMarker({ positionBeat: { num: 6, den: 4 } }), TEMPORAL_CONTEXT),
		musicalMarker({ positionBeat: { num: 3, den: 2 } }),
	);
	assert.deepEqual(
		createTimelineAnnotationV11(musicalRegion({ startBeat: 2, endBeat: { num: 12, den: 4 } }), TEMPORAL_CONTEXT),
		musicalRegion(),
	);
	for (const positionBeat of [
		{ num: -0, den: 1 },
		{ num: -1, den: 1 },
		{ num: 1, den: 0 },
		{ num: 1.5, den: 1 },
		{ num: 2, den: 2 },
		{ num: 1, den: Number.MAX_SAFE_INTEGER, cache: 0 },
		1,
	]) {
		assert.throws(
			() => validateTimelineAnnotationV11(musicalMarker({ positionBeat }), TEMPORAL_CONTEXT),
			/rational|canonical|safe integer|unsupported|non-negative|denominator/iu,
		);
	}
	assert.throws(
		() => validateTimelineAnnotationV11(sampleMarker({ positionFrame: -0 }), TEMPORAL_CONTEXT),
		/non-negative safe integer|negative zero/iu,
	);
});

test('regions require positive authoritative and projected spans', () => {
	for (const [startFrame, endFrame] of [[1, 1], [2, 1]]) {
		assert.throws(
			() => validateTimelineAnnotationV11(sampleRegion({ startFrame, endFrame }), TEMPORAL_CONTEXT),
			/positive/iu,
		);
	}
	for (const [startBeat, endBeat] of [
		[{ num: 1, den: 1 }, { num: 1, den: 1 }],
		[{ num: 2, den: 1 }, { num: 1, den: 1 }],
	] as const) {
		assert.throws(
			() => validateTimelineAnnotationV11(musicalRegion({ startBeat, endBeat }), TEMPORAL_CONTEXT),
			/positive/iu,
		);
	}
	assert.throws(
		() => validateTimelineAnnotationV11(musicalRegion({
			startBeat: { num: 0, den: 1 },
			endBeat: { num: 1, den: 1_000_000 },
		}), TEMPORAL_CONTEXT),
		/resolve.*positive|positive.*sample/iu,
		'authoritatively positive regions that round to one sample point reject',
	);
	assert.throws(
		() => createTimelineAnnotationsV11([musicalRegion({
			startBeat: { num: 0, den: 1 },
			endBeat: { num: 1, den: 1_000_000 },
		})], COLLECTION_CONTEXT),
		/resolve.*positive|positive.*sample/iu,
	);
	const tempoSensitiveRegion = musicalRegion({
		startBeat: { num: 0, den: 1 },
		endBeat: { num: 1, den: 100_000 },
	});
	assert.equal(validateTimelineAnnotationV11(tempoSensitiveRegion, {
		...TEMPORAL_CONTEXT,
		tempoMap: {
			mode: 'musical',
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 1, den: 1 } }],
		},
	}), true);
	assert.throws(() => validateTimelineAnnotationV11(tempoSensitiveRegion, {
		...TEMPORAL_CONTEXT,
		tempoMap: {
			mode: 'musical',
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 1_000, den: 1 } }],
		},
	}), /resolve.*positive|positive.*sample/iu, 'a tempo edit cannot leave a collapsed region');
});

test('annotation collection guards expose the exact V11 union to strict TypeScript consumers', () => {
	const unknownValue: unknown = [sampleMarker()];
	assert.ok(validateTimelineAnnotationsV11(unknownValue, COLLECTION_CONTEXT));
	const annotations: readonly TimelineAnnotationV11[] = unknownValue;
	assert.equal(annotations[0].kind, 'marker');
});
