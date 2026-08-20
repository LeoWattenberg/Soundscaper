/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	beatToSampleFrame,
	compareRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from './timeline-coordinate-limits.ts';
import {
	admitAudioEditorProjectValidationStructure,
	resolveAudioEditorProjectValidationLimits,
} from './project-validation-budget.ts';

export const AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS = Object.freeze([
	'auto',
	'blue',
	'violet',
	'magenta',
	'teal',
	'cyan',
	'green',
	'orange',
	'red',
	'yellow',
] as const);

export const AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS = Object.freeze({
	maximumAnnotations: 4_096,
	maximumIdCodeUnits: 256,
	maximumNameCodeUnits: 4_096,
});

export type TimelineAnnotationColor = typeof AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS[number];

export interface TimelineAnnotationCommonV11 {
	readonly id: string;
	readonly sequenceId: string;
	readonly name: string;
	readonly color: TimelineAnnotationColor;
	readonly batchId: string | null;
	readonly opaqueExtensions: Readonly<Record<string, unknown>>;
}

export interface SampleTimelineMarkerV11 extends TimelineAnnotationCommonV11 {
	readonly kind: 'marker';
	readonly anchor: 'sample';
	readonly positionFrame: number;
}

export interface MusicalTimelineMarkerV11 extends TimelineAnnotationCommonV11 {
	readonly kind: 'marker';
	readonly anchor: 'musical';
	readonly positionBeat: Rational;
}

export interface SampleTimelineRegionV11 extends TimelineAnnotationCommonV11 {
	readonly kind: 'region';
	readonly anchor: 'sample';
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface MusicalTimelineRegionV11 extends TimelineAnnotationCommonV11 {
	readonly kind: 'region';
	readonly anchor: 'musical';
	readonly startBeat: Rational;
	readonly endBeat: Rational;
}

export type TimelineAnnotationV11 =
	| SampleTimelineMarkerV11
	| MusicalTimelineMarkerV11
	| SampleTimelineRegionV11
	| MusicalTimelineRegionV11;

export interface TimelineAnnotationTemporalContext {
	readonly tempoMap: HoldTempoMap;
	readonly sampleRate: number;
}

export interface TimelineAnnotationCollectionContext extends TimelineAnnotationTemporalContext {
	readonly sequenceIds: Iterable<string>;
}

type DataRecord = Record<string, unknown>;
type BeatFrameResolver = (beat: RationalInput) => number;

const COMMON_KEYS = ['id', 'sequenceId', 'name', 'color', 'batchId', 'opaqueExtensions', 'kind', 'anchor'] as const;
const SAMPLE_MARKER_KEYS = new Set([...COMMON_KEYS, 'positionFrame']);
const MUSICAL_MARKER_KEYS = new Set([...COMMON_KEYS, 'positionBeat']);
const SAMPLE_REGION_KEYS = new Set([...COMMON_KEYS, 'startFrame', 'endFrame']);
const MUSICAL_REGION_KEYS = new Set([...COMMON_KEYS, 'startBeat', 'endBeat']);
const RATIONAL_KEYS = new Set(['num', 'den']);
const COLOR_SET: ReadonlySet<string> = new Set(AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS);
const INVALID_CANONICAL_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const EXTENSION_VALIDATION_LIMITS = resolveAudioEditorProjectValidationLimits();

/** Create one canonical persisted V11 annotation without adding derived coordinates. */
export function createTimelineAnnotationV11(
	value: unknown,
	context: TimelineAnnotationTemporalContext,
): TimelineAnnotationV11 {
	return createAnnotation(value, context, 'timeline annotation');
}

/** Create an ordered collection and validate its project graph relationships atomically. */
export function createTimelineAnnotationsV11(
	value: unknown,
	context: TimelineAnnotationCollectionContext,
): readonly TimelineAnnotationV11[] {
	const candidates = annotationArray(value, 'project.timelineAnnotations');
	const resolveBeatFrame = indexedBeatFrameResolver(context);
	const annotations = candidates.map((candidate, index) => createAnnotation(
		candidate,
		context,
		`project.timelineAnnotations[${String(index)}]`,
		resolveBeatFrame,
	));
	validateAnnotationCollection(annotations, context, 'project.timelineAnnotations', resolveBeatFrame);
	return annotations;
}

/** Validate one already-canonical wire annotation, including its resolved musical span. */
export function validateTimelineAnnotationV11(
	value: unknown,
	context: TimelineAnnotationTemporalContext,
): value is TimelineAnnotationV11 {
	validateAnnotation(value, context, 'timeline annotation');
	return true;
}

/** Validate the ordered V11 collection, ownership references, and batch affinity. */
export function validateTimelineAnnotationsV11(
	value: unknown,
	context: TimelineAnnotationCollectionContext,
): value is readonly TimelineAnnotationV11[] {
	const annotations = annotationArray(value, 'project.timelineAnnotations');
	validateAnnotationCollection(
		annotations,
		context,
		'project.timelineAnnotations',
		indexedBeatFrameResolver(context),
	);
	return true;
}

function createAnnotation(
	value: unknown,
	context: TimelineAnnotationTemporalContext,
	name: string,
	resolveBeatFrame?: BeatFrameResolver,
): TimelineAnnotationV11 {
	const candidate = annotationRecord(value, name);
	const kind = annotationKind(candidate.kind, `${name}.kind`);
	const anchor = annotationAnchor(candidate.anchor, `${name}.anchor`);
	assertClosedAnnotation(candidate, kind, anchor, name);
	const common = {
		id: annotationId(candidate.id, `${name}.id`),
		sequenceId: annotationId(candidate.sequenceId, `${name}.sequenceId`),
		name: annotationName(candidate.name, `${name}.name`),
		color: annotationColor(candidate.color, `${name}.color`),
		batchId: candidate.batchId === null ? null : annotationId(candidate.batchId, `${name}.batchId`),
		opaqueExtensions: cloneExtensions(candidate.opaqueExtensions, `${name}.opaqueExtensions`),
	};
	let result: TimelineAnnotationV11;
	if (kind === 'marker' && anchor === 'sample') {
		result = { ...common, kind, anchor, positionFrame: nonNegativeSafeInteger(candidate.positionFrame, `${name}.positionFrame`) };
	} else if (kind === 'marker') {
		result = {
			...common,
			kind,
			anchor: 'musical',
			positionBeat: normalizeCoordinate(candidate.positionBeat, `${name}.positionBeat`),
		};
	} else if (anchor === 'sample') {
		result = {
			...common,
			kind,
			anchor,
			startFrame: nonNegativeSafeInteger(candidate.startFrame, `${name}.startFrame`),
			endFrame: nonNegativeSafeInteger(candidate.endFrame, `${name}.endFrame`),
		};
	} else {
		result = {
			...common,
			kind,
			anchor,
			startBeat: normalizeCoordinate(candidate.startBeat, `${name}.startBeat`),
			endBeat: normalizeCoordinate(candidate.endBeat, `${name}.endBeat`),
		};
	}
	validateAnnotation(result, context, name, resolveBeatFrame);
	return result;
}

function validateAnnotation(
	value: unknown,
	context: TimelineAnnotationTemporalContext,
	name: string,
	resolveBeatFrame?: BeatFrameResolver,
): asserts value is TimelineAnnotationV11 {
	const candidate = annotationRecord(value, name);
	const kind = annotationKind(candidate.kind, `${name}.kind`);
	const anchor = annotationAnchor(candidate.anchor, `${name}.anchor`);
	assertClosedAnnotation(candidate, kind, anchor, name);
	annotationId(candidate.id, `${name}.id`);
	annotationId(candidate.sequenceId, `${name}.sequenceId`);
	annotationName(candidate.name, `${name}.name`);
	annotationColor(candidate.color, `${name}.color`);
	if (candidate.batchId !== null) annotationId(candidate.batchId, `${name}.batchId`);
	extensionRecord(candidate.opaqueExtensions, `${name}.opaqueExtensions`);
	const sampleRate = positiveSafeInteger(context?.sampleRate, 'annotation context sampleRate');
	if (kind === 'marker' && anchor === 'sample') {
		nonNegativeSafeInteger(candidate.positionFrame, `${name}.positionFrame`);
		return;
	}
	if (kind === 'marker') {
		const beat = canonicalCoordinate(candidate.positionBeat, `${name}.positionBeat`);
		assertResolvedPoint(beat, context.tempoMap, sampleRate, name, resolveBeatFrame);
		return;
	}
	if (anchor === 'sample') {
		const start = nonNegativeSafeInteger(candidate.startFrame, `${name}.startFrame`);
		const end = nonNegativeSafeInteger(candidate.endFrame, `${name}.endFrame`);
		if (end <= start) throw new RangeError(`${name} must have a positive sample region.`);
		return;
	}
	const start = canonicalCoordinate(candidate.startBeat, `${name}.startBeat`);
	const end = canonicalCoordinate(candidate.endBeat, `${name}.endBeat`);
	if (compareRationals(start, end) >= 0) throw new RangeError(`${name} must have a positive musical region.`);
	const resolvedStart = resolveBeatFrame?.(start)
		?? beatToSampleFrame(start, context.tempoMap, sampleRate, 'point');
	const resolvedEnd = resolveBeatFrame?.(end)
		?? beatToSampleFrame(end, context.tempoMap, sampleRate, 'point');
	if (resolvedStart < 0 || resolvedEnd <= resolvedStart) {
		throw new RangeError(`${name} must resolve to a positive sample region.`);
	}
}

function validateAnnotationCollection(
	annotations: readonly unknown[],
	context: TimelineAnnotationCollectionContext,
	name: string,
	resolveBeatFrame: BeatFrameResolver,
): asserts annotations is readonly TimelineAnnotationV11[] {
	const sequenceIds = sequenceIdSet(context?.sequenceIds);
	const annotationIds = new Set<string>();
	const batchSequences = new Map<string, string>();
	for (const [index, annotation] of annotations.entries()) {
		const itemName = `${name}[${String(index)}]`;
		validateAnnotation(annotation, context, itemName, resolveBeatFrame);
		if (annotationIds.has(annotation.id)) {
			throw new RangeError(`${name} cannot contain duplicate annotation ID: ${annotation.id}.`);
		}
		annotationIds.add(annotation.id);
		if (!sequenceIds.has(annotation.sequenceId)) {
			throw new ReferenceError(`${itemName} references missing sequence ${annotation.sequenceId}.`);
		}
		if (annotation.batchId === null) continue;
		const existingSequence = batchSequences.get(annotation.batchId);
		if (existingSequence !== undefined && existingSequence !== annotation.sequenceId) {
			throw new RangeError(`Annotation batch ${annotation.batchId} must belong to one sequence.`);
		}
		batchSequences.set(annotation.batchId, annotation.sequenceId);
	}
}

function assertClosedAnnotation(
	value: DataRecord,
	kind: TimelineAnnotationV11['kind'],
	anchor: TimelineAnnotationV11['anchor'],
	name: string,
): void {
	const allowed = kind === 'marker'
		? anchor === 'sample' ? SAMPLE_MARKER_KEYS : MUSICAL_MARKER_KEYS
		: anchor === 'sample' ? SAMPLE_REGION_KEYS : MUSICAL_REGION_KEYS;
	assertClosedOwnDataRecord(value, allowed, name);
}

function annotationArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	if (value.length > AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations) {
		throw new RangeError(`${name} cannot exceed ${String(AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations)} annotations.`);
	}
	return value;
}

function annotationRecord(value: unknown, name: string): DataRecord {
	if (!isPlainRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function extensionRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	admitAudioEditorProjectValidationStructure(value, EXTENSION_VALIDATION_LIMITS);
	if (!isPlainRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function cloneExtensions(value: unknown, name: string): Readonly<Record<string, unknown>> {
	const extensions = extensionRecord(value, name);
	try {
		return structuredClone(extensions) as Readonly<Record<string, unknown>>;
	} catch {
		throw new TypeError(`${name} must be cloneable.`);
	}
}

function annotationKind(value: unknown, name: string): TimelineAnnotationV11['kind'] {
	if (value !== 'marker' && value !== 'region') throw new RangeError(`${name} must be marker or region.`);
	return value;
}

function annotationAnchor(value: unknown, name: string): TimelineAnnotationV11['anchor'] {
	if (value !== 'sample' && value !== 'musical') throw new RangeError(`${name} must be sample or musical.`);
	return value;
}

function annotationColor(value: unknown, name: string): TimelineAnnotationColor {
	if (typeof value !== 'string' || !COLOR_SET.has(value)) throw new RangeError(`${name} is unsupported.`);
	return value as TimelineAnnotationColor;
}

function annotationId(value: unknown, name: string): string {
	return canonicalString(value, name, AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumIdCodeUnits, false);
}

function annotationName(value: unknown, name: string): string {
	return canonicalString(value, name, AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumNameCodeUnits, true);
}

function canonicalString(value: unknown, name: string, maximumLength: number, allowEmpty: boolean): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		throw new TypeError(`${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
	}
	if (value !== value.trim()) throw new TypeError(`${name} must be a canonical string.`);
	if (value.length > maximumLength) throw new RangeError(`${name} length exceeds its maximum.`);
	if (INVALID_CANONICAL_TEXT.test(value)) {
		throw new TypeError(`${name} must be single-line and contain no control or formatting characters.`);
	}
	return value;
}

function normalizeCoordinate(value: unknown, name: string): Rational {
	if (typeof value === 'object') assertClosedRational(value, name);
	if (typeof value !== 'number' && !isPlainRecord(value)) throw new TypeError(`${name} must be rational.`);
	const result = normalizeRational(value as RationalInput, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
	if (result.num < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function canonicalCoordinate(value: unknown, name: string): Rational {
	if (!isPlainRecord(value)) throw new TypeError(`${name} must be a canonical rational wire object.`);
	assertClosedRational(value, name);
	const num = nonNegativeSafeInteger(value.num, `${name}.num`);
	const den = positiveSafeInteger(value.den, `${name}.den`);
	if (den > AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR) {
		throw new RangeError(`${name}.den exceeds its denominator bound.`);
	}
	const normalized = normalizeRational({ num, den }, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
	if (normalized.num !== num || normalized.den !== den) throw new RangeError(`${name} must be canonically reduced.`);
	return normalized;
}

function assertClosedRational(value: unknown, name: string): void {
	if (!isPlainRecord(value)) throw new TypeError(`${name} must be rational.`);
	assertClosedOwnDataRecord(value, RATIONAL_KEYS, name);
}

function assertClosedOwnDataRecord(value: DataRecord, allowed: ReadonlySet<string>, name: string): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
}

function assertResolvedPoint(
	beat: Rational,
	tempoMap: HoldTempoMap,
	sampleRate: number,
	name: string,
	resolveBeatFrame?: BeatFrameResolver,
): void {
	const resolved = resolveBeatFrame?.(beat) ?? beatToSampleFrame(beat, tempoMap, sampleRate, 'point');
	if (resolved < 0) throw new RangeError(`${name} must resolve to a non-negative sample position.`);
}

function indexedBeatFrameResolver(context: TimelineAnnotationTemporalContext): BeatFrameResolver {
	const sampleRate = positiveSafeInteger(context?.sampleRate, 'annotation context sampleRate');
	return createIndexedBeatFrameProjector(context.tempoMap, sampleRate);
}

function sequenceIdSet(value: Iterable<string> | undefined): ReadonlySet<string> {
	if (!value || typeof value === 'string' || typeof value[Symbol.iterator] !== 'function') {
		throw new TypeError('annotation context sequenceIds must be iterable.');
	}
	const result = new Set<string>();
	for (const sequenceId of value) result.add(annotationId(sequenceId, 'annotation context sequence ID'));
	return result;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function isPlainRecord(value: unknown): value is DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
