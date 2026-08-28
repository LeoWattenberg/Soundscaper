/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import {
	resolveRuntimeTimelineAnnotationsInDocumentOrder,
	restoreTimelineAnnotationsFromRuntimeProjection,
	type RuntimeTimelineAnnotationProject,
	type RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';
import { isRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import {
	createTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from '../timeline-coordinate-limits.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';
import {
	addRationals,
	compareRationals,
	normalizeRational,
	subtractRationals,
	type HoldTempoMap,
	type Rational,
} from '../timeline-time.ts';
import type {
	TimelineAnnotationRippleOperation,
} from './protocol.ts';
import type { RangeSequenceGeometry } from './range-sequence-geometry.ts';

type DataRecord = Record<string, unknown>;

interface MutableRippleProject extends DataRecord {
	schemaVersion: number;
	sampleRate: number;
	tempoMap: HoldTempoMap;
	sequences: readonly Readonly<{ readonly id: unknown }>[];
	tracks: readonly DataRecord[];
	timelineAnnotations: RuntimeTimelineAnnotationProjection[];
}

/** Create exact dual-domain operations only for completely covered media sequences. */
export function createTimelineAnnotationRippleOperations(
	projectValue: unknown,
	geometry: RangeSequenceGeometry,
	targetClipIdsValue: readonly string[],
): readonly TimelineAnnotationRippleOperation[] {
	const project = dataRecord(projectValue, 'project');
	if (!isTimelineAnnotationProjectSchema(project)) return Object.freeze([]);
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const tempoMap = dataRecord(project.tempoMap, 'project.tempoMap') as HoldTempoMap & DataRecord;
	const tracks = recordArray(project.tracks, 'project.tracks');
	const trackById = new Map(tracks.map((track, index) => [
		stableId(track.id, `project.tracks[${String(index)}].id`),
		track,
	]));
	const targetClipIds = new Set(canonicalStringArray(targetClipIdsValue, 'targetClipIds'));
	return Object.freeze(geometry.sequences.flatMap((sequence) => {
		if (!sequence.sampleRange || !sequence.mediaTrackIds.length
			|| sequence.targetedMediaTrackIds.length !== sequence.mediaTrackIds.length) return [];
		const targetedTracks = new Set(sequence.targetedMediaTrackIds);
		if (!sequence.mediaTrackIds.every((trackId) => targetedTracks.has(trackId))) return [];
		for (const trackId of sequence.mediaTrackIds) {
			const track = trackById.get(trackId);
			if (!track || !Array.isArray(track.clipIds)) return [];
			const clipIds = canonicalStringArray(track.clipIds, `track ${trackId}.clipIds`);
			if (!clipIds.every((clipId) => targetClipIds.has(clipId))) return [];
		}
		const { startFrame, endFrame } = sequence.sampleRange;
		return [Object.freeze({
			sequenceId: sequence.sequenceId,
			sampleRange: Object.freeze({ startFrame, endFrame }),
			musicalRange: Object.freeze({
				startBeat: sampleFrameToBeat(startFrame, tempoMap, sampleRate),
				endBeat: sampleFrameToBeat(endFrame, tempoMap, sampleRate),
			}),
		})];
	}));
}

/** Validate and stage a complete projected collection before any media mutation runs. */
export function stageTimelineAnnotationRippleMutation(
	projectValue: unknown,
	commandValue: unknown,
	expectedOperations: readonly TimelineAnnotationRippleOperation[],
): () => void {
	const project = dataRecord(projectValue, 'project') as MutableRippleProject;
	const command = dataRecord(commandValue, 'range ripple-delete command');
	const ownsOperations = Object.hasOwn(command, 'annotationRippleOperations');
	if (!isTimelineAnnotationProjectSchema(project)) {
		if (ownsOperations) {
			throw new RangeError('Annotation ripple operations are only valid for a schema 11 or 12 ripple delete.');
		}
		return () => undefined;
	}
	if (!ownsOperations) throw new TypeError('A schema 11 or 12 ripple delete requires annotation ripple operations.');
	if (!isRuntimeProjectProjection(project)) {
		throw new TypeError('Timeline annotation ripple requires a trusted runtime projection.');
	}
	const operations = annotationRippleOperations(command.annotationRippleOperations);
	assertOperationsMatch(operations, expectedOperations);
	const operationBySequence = new Map(operations.map((operation) => [operation.sequenceId, operation]));
	const authoritative = restoreTimelineAnnotationsFromRuntimeProjection(
		project as unknown as RuntimeTimelineAnnotationProject,
	);
	const candidate = authoritative.flatMap((annotation) => {
		const operation = operationBySequence.get(annotation.sequenceId);
		if (!operation) return [annotation];
		const replacement = contractTimelineAnnotation(annotation, operation);
		return replacement ? [replacement] : [];
	});
	const canonical = createTimelineAnnotationsV11(candidate, {
		sampleRate: project.sampleRate,
		tempoMap: project.tempoMap,
		sequenceIds: project.sequences.map((sequence, index) => (
			stableId(sequence.id, `project.sequences[${String(index)}].id`)
		)),
	});
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder({
		...project,
		timelineAnnotations: canonical,
	});
	return () => {
		project.timelineAnnotations.splice(0, project.timelineAnnotations.length, ...projected);
	};
}

function contractTimelineAnnotation(
	annotation: TimelineAnnotationV11,
	operation: TimelineAnnotationRippleOperation,
): TimelineAnnotationV11 | null {
	if (annotation.kind === 'marker' && annotation.anchor === 'sample') {
		const positionFrame = contractSamplePoint(annotation.positionFrame, operation.sampleRange);
		return positionFrame === null ? null : { ...annotation, positionFrame };
	}
	if (annotation.kind === 'marker') {
		const positionBeat = contractMusicalPoint(annotation.positionBeat, operation.musicalRange);
		return positionBeat === null ? null : { ...annotation, positionBeat };
	}
	if (annotation.anchor === 'sample') {
		const range = contractSampleRegion(annotation.startFrame, annotation.endFrame, operation.sampleRange);
		return range ? { ...annotation, ...range } : null;
	}
	const range = contractMusicalRegion(annotation.startBeat, annotation.endBeat, operation.musicalRange);
	return range ? { ...annotation, ...range } : null;
}

function contractSamplePoint(position: number, range: TimelineAnnotationRippleOperation['sampleRange']): number | null {
	if (position < range.startFrame) return position;
	if (position < range.endFrame) return null;
	return position - (range.endFrame - range.startFrame);
}

function contractMusicalPoint(
	position: Rational,
	range: TimelineAnnotationRippleOperation['musicalRange'],
): Rational | null {
	if (compareRationals(position, range.startBeat) < 0) return position;
	if (compareRationals(position, range.endBeat) < 0) return null;
	return addRationals(position, subtractRationals(range.startBeat, range.endBeat));
}

function contractSampleRegion(
	startFrame: number,
	endFrame: number,
	range: TimelineAnnotationRippleOperation['sampleRange'],
): Readonly<{ startFrame: number; endFrame: number }> | null {
	if (endFrame <= range.startFrame) return { startFrame, endFrame };
	const delta = range.startFrame - range.endFrame;
	if (startFrame >= range.endFrame) return { startFrame: startFrame + delta, endFrame: endFrame + delta };
	const replacement = {
		startFrame: startFrame < range.startFrame ? startFrame : range.startFrame,
		endFrame: endFrame <= range.endFrame ? range.startFrame : endFrame + delta,
	};
	return replacement.endFrame > replacement.startFrame ? replacement : null;
}

function contractMusicalRegion(
	startBeat: Rational,
	endBeat: Rational,
	range: TimelineAnnotationRippleOperation['musicalRange'],
): Readonly<{ startBeat: Rational; endBeat: Rational }> | null {
	if (compareRationals(endBeat, range.startBeat) <= 0) return { startBeat, endBeat };
	const delta = subtractRationals(range.startBeat, range.endBeat);
	if (compareRationals(startBeat, range.endBeat) >= 0) {
		return { startBeat: addRationals(startBeat, delta), endBeat: addRationals(endBeat, delta) };
	}
	const replacement = {
		startBeat: compareRationals(startBeat, range.startBeat) < 0 ? startBeat : range.startBeat,
		endBeat: compareRationals(endBeat, range.endBeat) <= 0
			? range.startBeat
			: addRationals(endBeat, delta),
	};
	return compareRationals(replacement.endBeat, replacement.startBeat) > 0 ? replacement : null;
}

function annotationRippleOperations(value: unknown): readonly TimelineAnnotationRippleOperation[] {
	const values = denseArray(value, 'annotation ripple operations', 1_024);
	const sequenceIds = new Set<string>();
	return Object.freeze(values.map((value, index) => {
		const name = `annotation ripple operations[${String(index)}]`;
		const operation = closedRecord(value, ['sequenceId', 'sampleRange', 'musicalRange'], name);
		const sequenceId = stableId(operation.sequenceId, `${name}.sequenceId`);
		if (sequenceIds.has(sequenceId)) throw new RangeError('Annotation ripple operations cannot repeat a sequence.');
		sequenceIds.add(sequenceId);
		const sampleRange = commandSampleRange(operation.sampleRange, `${name}.sampleRange`);
		const musicalRange = commandMusicalRange(operation.musicalRange, `${name}.musicalRange`);
		return Object.freeze({ sequenceId, sampleRange, musicalRange });
	}));
}

function commandSampleRange(value: unknown, name: string): TimelineAnnotationRippleOperation['sampleRange'] {
	const range = closedRecord(value, ['startFrame', 'endFrame'], name);
	const startFrame = nonNegativeSafeInteger(range.startFrame, `${name}.startFrame`);
	const endFrame = nonNegativeSafeInteger(range.endFrame, `${name}.endFrame`);
	if (endFrame <= startFrame) throw new RangeError(`${name} must have a positive duration.`);
	return Object.freeze({ startFrame, endFrame });
}

function commandMusicalRange(value: unknown, name: string): TimelineAnnotationRippleOperation['musicalRange'] {
	const range = closedRecord(value, ['startBeat', 'endBeat'], name);
	const startBeat = commandRational(range.startBeat, `${name}.startBeat`);
	const endBeat = commandRational(range.endBeat, `${name}.endBeat`);
	if (compareRationals(startBeat, endBeat) >= 0) throw new RangeError(`${name} must have a positive duration.`);
	return Object.freeze({ startBeat, endBeat });
}

function commandRational(value: unknown, name: string): Rational {
	const candidate = closedRecord(value, ['num', 'den'], name);
	const num = nonNegativeSafeInteger(candidate.num, `${name}.num`);
	const den = positiveSafeInteger(candidate.den, `${name}.den`);
	const normalized = normalizeRational({ num, den }, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
	if (normalized.num !== num || normalized.den !== den) throw new RangeError(`${name} must be canonically reduced.`);
	return normalized;
}

function assertOperationsMatch(
	actual: readonly TimelineAnnotationRippleOperation[],
	expected: readonly TimelineAnnotationRippleOperation[],
): void {
	const matches = actual.length === expected.length && actual.every((operation, index) => {
		const candidate = expected[index];
		return operation.sequenceId === candidate.sequenceId
			&& operation.sampleRange.startFrame === candidate.sampleRange.startFrame
			&& operation.sampleRange.endFrame === candidate.sampleRange.endFrame
			&& operation.musicalRange.startBeat.num === candidate.musicalRange.startBeat.num
			&& operation.musicalRange.startBeat.den === candidate.musicalRange.startBeat.den
			&& operation.musicalRange.endBeat.num === candidate.musicalRange.endBeat.num
			&& operation.musicalRange.endBeat.den === candidate.musicalRange.endBeat.den;
	});
	if (!matches) throw new RangeError('Annotation ripple operations must exactly match complete sequence geometry.');
}

function denseArray(value: unknown, name: string, maximumLength: number): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	if (value.length > maximumLength) throw new RangeError(`${name} exceeds its maximum length.`);
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !arrayIndex(key, value.length)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
	for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) {
		throw new TypeError(`${name} must be dense.`);
	}
	return value;
}

function arrayIndex(value: string, length: number): boolean {
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false;
	const index = Number(value);
	return Number.isSafeInteger(index) && index < length && String(index) === value;
}

function closedRecord(value: unknown, keys: readonly string[], name: string): DataRecord {
	const candidate = dataRecord(value, name);
	const allowed = new Set(keys);
	for (const key of Reflect.ownKeys(candidate)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
	for (const key of keys) if (!Object.hasOwn(candidate, key)) throw new TypeError(`${name}.${key} is required.`);
	return candidate;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function canonicalStringArray(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const seen = new Set<string>();
	return value.map((candidate, index) => {
		const result = stableId(candidate, `${name}[${String(index)}]`);
		if (seen.has(result)) throw new RangeError(`${name} cannot contain duplicate IDs.`);
		seen.add(result);
		return result;
	});
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
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
