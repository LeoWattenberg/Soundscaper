/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from '../timeline-coordinate-limits.ts';
import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import {
	createTimelineAnnotationsV11,
	type TimelineAnnotationCollectionContext,
	type TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import {
	resolveRuntimeTimelineAnnotationsInDocumentOrder,
	restoreTimelineAnnotationsFromRuntimeProjection,
	type RuntimeTimelineAnnotationProject,
	type RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';
import { isRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import {
	addRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
} from '../timeline-time.ts';
import {
	defineTimelineAnnotationCommandHandlers,
	type TimelineAnnotationCommand,
	type TimelineAnnotationCommandHandlers,
	type TimelineAnnotationConversionCoordinates,
	type TimelineAnnotationMoveDelta,
	type TimelineAnnotationResizeCoordinate,
	type TimelineAnnotationUpdateChanges,
} from './timeline-annotation.ts';
import type { EditorCommandProject } from './protocol.ts';
import { nonNegativeSafeInteger, positiveSafeInteger, safeInteger } from './scalar-guards.ts';

type DataRecord = Record<string, unknown>;

export interface MutableTimelineAnnotationProject extends Record<string, unknown> {
	sampleRate: number;
	tempoMap: HoldTempoMap;
	sequences: readonly Readonly<{ readonly id: unknown }>[];
	timelineAnnotations: TimelineAnnotationV11[];
}

interface MutableProjectedTimelineAnnotationProject extends Record<string, unknown> {
	schemaVersion: number;
	sampleRate: number;
	tempoMap: HoldTempoMap;
	sequences: readonly Readonly<{ readonly id: unknown }>[];
	timelineAnnotations: RuntimeTimelineAnnotationProjection[];
}

const RUNTIME_HANDLERS = defineTimelineAnnotationCommandHandlers({
	'timeline-annotation/add': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
	'timeline-annotation/update-many': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
	'timeline-annotation/move-many': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
	'timeline-annotation/resize': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
	'timeline-annotation/convert': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
	'timeline-annotation/remove-many': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
	'timeline-annotation/batch-set': (project, command) => applyProjectedTimelineAnnotationCommand(project, command),
});

export function createTimelineAnnotationRuntimeHandlers(): Readonly<TimelineAnnotationCommandHandlers> {
	return RUNTIME_HANDLERS;
}

/** Apply a global command through a schema-11-or-12 branded runtime projection. */
export function applyProjectedTimelineAnnotationCommand(
	project: EditorCommandProject,
	command: TimelineAnnotationCommand,
): void {
	const candidate = project as MutableProjectedTimelineAnnotationProject;
	if (!isTimelineAnnotationProjectSchema(candidate)) {
		throw new RangeError('Timeline annotation commands require schema 11 or 12.');
	}
	if (!isRuntimeProjectProjection(candidate)) {
		throw new TypeError('Timeline annotation commands require a trusted runtime projection.');
	}
	const authoritative = restoreTimelineAnnotationsFromRuntimeProjection(
		candidate as unknown as RuntimeTimelineAnnotationProject,
	);
	const staged: MutableTimelineAnnotationProject = {
		...candidate,
		timelineAnnotations: Array.from(authoritative),
	};
	const context = mutationContext(staged, undefined);
	applyTimelineAnnotationCommand(staged, command, context);
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder({
		...candidate,
		timelineAnnotations: staged.timelineAnnotations,
	});
	candidate.timelineAnnotations.splice(
		0,
		candidate.timelineAnnotations.length,
		...projected,
	);
}

/** Apply one command only after its complete candidate collection validates. */
export function applyTimelineAnnotationCommand(
	project: MutableTimelineAnnotationProject,
	command: TimelineAnnotationCommand,
	context?: TimelineAnnotationCollectionContext,
): void {
	const candidate = assertOnlyKeys(
		commandRecord(command, 'timeline annotation command'),
		[
			'type', 'annotation', 'annotationIds', 'changes', 'delta',
			'annotationId', 'edge', 'coordinate', 'coordinates', 'batchId',
		],
		'timeline annotation command',
	);
	switch (candidate.type) {
		case 'timeline-annotation/add': {
			const exact = assertOnlyKeys(candidate, ['type', 'annotation'], 'timeline annotation add command');
			addAnnotation(project, exact.annotation as TimelineAnnotationV11, mutationContext(project, context));
			return;
		}
		case 'timeline-annotation/update-many': {
			const exact = assertOnlyKeys(
				candidate,
				['type', 'annotationIds', 'changes'],
				'timeline annotation update-many command',
			);
			updateMany(
				project,
				exact.annotationIds,
				exact.changes as TimelineAnnotationUpdateChanges,
				mutationContext(project, context),
			);
			return;
		}
		case 'timeline-annotation/move-many': {
			const exact = assertOnlyKeys(
				candidate,
				['type', 'annotationIds', 'delta'],
				'timeline annotation move-many command',
			);
			moveMany(
				project,
				exact.annotationIds,
				exact.delta as TimelineAnnotationMoveDelta,
				mutationContext(project, context),
			);
			return;
		}
		case 'timeline-annotation/resize': {
			const exact = assertOnlyKeys(
				candidate,
				['type', 'annotationId', 'edge', 'coordinate'],
				'timeline annotation resize command',
			);
			resizeAnnotation(
				project,
				exact.annotationId,
				exact.edge,
				exact.coordinate as TimelineAnnotationResizeCoordinate,
				mutationContext(project, context),
			);
			return;
		}
		case 'timeline-annotation/convert': {
			const exact = assertOnlyKeys(
				candidate,
				['type', 'annotationId', 'coordinates'],
				'timeline annotation convert command',
			);
			convertAnnotation(
				project,
				exact.annotationId,
				exact.coordinates as TimelineAnnotationConversionCoordinates,
				mutationContext(project, context),
			);
			return;
		}
		case 'timeline-annotation/remove-many': {
			const exact = assertOnlyKeys(candidate, ['type', 'annotationIds'], 'timeline annotation remove-many command');
			removeMany(project, exact.annotationIds, mutationContext(project, context));
			return;
		}
		case 'timeline-annotation/batch-set': {
			const exact = assertOnlyKeys(
				candidate,
				['type', 'annotationIds', 'batchId'],
				'timeline annotation batch-set command',
			);
			setBatch(project, exact.annotationIds, exact.batchId, mutationContext(project, context));
			return;
		}
		default:
			throw new RangeError(`Unsupported timeline annotation command: ${String(candidate.type)}.`);
	}
}

function addAnnotation(
	project: MutableTimelineAnnotationProject,
	annotation: TimelineAnnotationV11,
	context: TimelineAnnotationCollectionContext,
): void {
	commitCandidate(project, [...annotationCollection(project), annotation], context);
}

function updateMany(
	project: MutableTimelineAnnotationProject,
	annotationIds: unknown,
	changesValue: TimelineAnnotationUpdateChanges,
	context: TimelineAnnotationCollectionContext,
): void {
	const ids = targetIds(project, annotationIds);
	const changes = assertOnlyKeys(
		commandRecord(changesValue, 'timeline annotation update changes'),
		['name', 'color'],
		'timeline annotation update changes',
	);
	if (!Object.keys(changes).length) throw new TypeError('Timeline annotation update changes cannot be empty.');
	commitCandidate(project, annotationCollection(project).map((annotation) => (
		ids.has(annotation.id) ? { ...annotation, ...changes } as TimelineAnnotationV11 : annotation
	)), context);
}

function moveMany(
	project: MutableTimelineAnnotationProject,
	annotationIds: unknown,
	deltaValue: TimelineAnnotationMoveDelta,
	context: TimelineAnnotationCollectionContext,
): void {
	const ids = targetIds(project, annotationIds);
	const delta = assertOnlyKeys(
		commandRecord(deltaValue, 'timeline annotation move delta'),
		['sampleFrames', 'beats'],
		'timeline annotation move delta',
	);
	const sampleDelta = safeInteger(delta.sampleFrames, 'timeline annotation sample delta');
	const musicalDelta = canonicalDelta(delta.beats, 'timeline annotation musical delta');
	commitCandidate(project, annotationCollection(project).map((annotation) => (
		ids.has(annotation.id) ? moveAnnotation(annotation, sampleDelta, musicalDelta) : annotation
	)), context);
}

function moveAnnotation(
	annotation: TimelineAnnotationV11,
	sampleDelta: number,
	musicalDelta: Rational,
): TimelineAnnotationV11 {
	if (annotation.kind === 'marker' && annotation.anchor === 'sample') {
		return { ...annotation, positionFrame: safeAdd(annotation.positionFrame, sampleDelta, 'annotation position') };
	}
	if (annotation.kind === 'marker') {
		return { ...annotation, positionBeat: addRationals(annotation.positionBeat, musicalDelta) };
	}
	if (annotation.anchor === 'sample') {
		return {
			...annotation,
			startFrame: safeAdd(annotation.startFrame, sampleDelta, 'annotation region start'),
			endFrame: safeAdd(annotation.endFrame, sampleDelta, 'annotation region end'),
		};
	}
	return {
		...annotation,
		startBeat: addRationals(annotation.startBeat, musicalDelta),
		endBeat: addRationals(annotation.endBeat, musicalDelta),
	};
}

function resizeAnnotation(
	project: MutableTimelineAnnotationProject,
	annotationIdValue: unknown,
	edgeValue: unknown,
	coordinateValue: TimelineAnnotationResizeCoordinate,
	context: TimelineAnnotationCollectionContext,
): void {
	const annotationId = stableId(annotationIdValue, 'timeline annotation ID');
	const annotation = requireAnnotation(project, annotationId);
	if (annotation.kind !== 'region') throw new RangeError('Only a timeline annotation region can be resized.');
	if (edgeValue !== 'start' && edgeValue !== 'end') throw new RangeError('Annotation resize edge must be start or end.');
	const coordinate = resizeCoordinate(coordinateValue);
	if (coordinate.anchor !== annotation.anchor) {
		throw new RangeError('Annotation resize coordinate must match the authoritative anchor.');
	}
	let replacement: TimelineAnnotationV11;
	if (annotation.anchor === 'sample' && coordinate.anchor === 'sample') {
		replacement = edgeValue === 'start'
			? { ...annotation, startFrame: coordinate.frame }
			: { ...annotation, endFrame: coordinate.frame };
	} else if (annotation.anchor === 'musical' && coordinate.anchor === 'musical') {
		replacement = edgeValue === 'start'
			? { ...annotation, startBeat: coordinate.beat }
			: { ...annotation, endBeat: coordinate.beat };
	} else {
		throw new RangeError('Annotation resize coordinate must match the authoritative anchor.');
	}
	replaceOne(project, annotationId, replacement, context);
}

function convertAnnotation(
	project: MutableTimelineAnnotationProject,
	annotationIdValue: unknown,
	coordinatesValue: TimelineAnnotationConversionCoordinates,
	context: TimelineAnnotationCollectionContext,
): void {
	const annotationId = stableId(annotationIdValue, 'timeline annotation ID');
	const annotation = requireAnnotation(project, annotationId);
	const coordinates = conversionCoordinates(coordinatesValue);
	const replacement = { ...annotationCommon(annotation), ...coordinates } as TimelineAnnotationV11;
	replaceOne(project, annotationId, replacement, context);
}

function removeMany(
	project: MutableTimelineAnnotationProject,
	annotationIds: unknown,
	context: TimelineAnnotationCollectionContext,
): void {
	const ids = targetIds(project, annotationIds);
	commitCandidate(project, annotationCollection(project).filter(({ id }) => !ids.has(id)), context);
}

function setBatch(
	project: MutableTimelineAnnotationProject,
	annotationIds: unknown,
	batchIdValue: unknown,
	context: TimelineAnnotationCollectionContext,
): void {
	const ids = targetIds(project, annotationIds);
	const batchId = batchIdValue === null ? null : stableId(batchIdValue, 'timeline annotation batch ID');
	commitCandidate(project, annotationCollection(project).map((annotation) => (
		ids.has(annotation.id) ? { ...annotation, batchId } : annotation
	)), context);
}

function replaceOne(
	project: MutableTimelineAnnotationProject,
	annotationId: string,
	replacement: TimelineAnnotationV11,
	context: TimelineAnnotationCollectionContext,
): void {
	commitCandidate(project, annotationCollection(project).map((annotation) => (
		annotation.id === annotationId ? replacement : annotation
	)), context);
}

function commitCandidate(
	project: MutableTimelineAnnotationProject,
	candidate: readonly TimelineAnnotationV11[],
	context: TimelineAnnotationCollectionContext,
): void {
	const canonical = createTimelineAnnotationsV11(candidate, context);
	project.timelineAnnotations.splice(0, project.timelineAnnotations.length, ...canonical);
}

function mutationContext(
	project: MutableTimelineAnnotationProject,
	context: TimelineAnnotationCollectionContext | undefined,
): TimelineAnnotationCollectionContext {
	if (context !== undefined) return context;
	if (!Array.isArray(project.sequences)) throw new TypeError('project.sequences must be an array.');
	return {
		sampleRate: project.sampleRate,
		tempoMap: project.tempoMap,
		sequenceIds: project.sequences.map((sequence) => stableId(sequence?.id, 'project sequence ID')),
	};
}

function annotationCollection(project: MutableTimelineAnnotationProject): TimelineAnnotationV11[] {
	if (!project || typeof project !== 'object') throw new TypeError('A timeline annotation project is required.');
	if (!Array.isArray(project.timelineAnnotations)) throw new TypeError('project.timelineAnnotations must be an array.');
	return project.timelineAnnotations;
}

function targetIds(project: MutableTimelineAnnotationProject, value: unknown): ReadonlySet<string> {
	if (!Array.isArray(value) || !value.length) throw new TypeError('Timeline annotation IDs must be a non-empty array.');
	const ids = new Set<string>();
	for (const [index, candidate] of value.entries()) {
		const id = stableId(candidate, `timeline annotation IDs[${String(index)}]`);
		if (ids.has(id)) throw new RangeError(`Duplicate timeline annotation command target: ${id}.`);
		ids.add(id);
	}
	const existing = new Set(annotationCollection(project).map(({ id }) => id));
	for (const id of ids) if (!existing.has(id)) throw new ReferenceError(`Unknown timeline annotation: ${id}.`);
	return ids;
}

function requireAnnotation(project: MutableTimelineAnnotationProject, annotationId: string): TimelineAnnotationV11 {
	const annotation = annotationCollection(project).find(({ id }) => id === annotationId);
	if (!annotation) throw new ReferenceError(`Unknown timeline annotation: ${annotationId}.`);
	return annotation;
}

function annotationCommon(annotation: TimelineAnnotationV11) {
	return {
		id: annotation.id,
		sequenceId: annotation.sequenceId,
		name: annotation.name,
		color: annotation.color,
		batchId: annotation.batchId,
		opaqueExtensions: annotation.opaqueExtensions,
	};
}

function resizeCoordinate(value: unknown): TimelineAnnotationResizeCoordinate {
	const candidate = assertOnlyKeys(
		commandRecord(value, 'timeline annotation resize coordinate'),
		['anchor', 'frame', 'beat'],
		'timeline annotation resize coordinate',
	);
	if (candidate.anchor === 'sample') {
		assertOnlyKeys(candidate, ['anchor', 'frame'], 'timeline annotation resize coordinate');
		return { anchor: 'sample', frame: nonNegativeSafeInteger(candidate.frame, 'annotation resize frame') };
	}
	if (candidate.anchor === 'musical') {
		assertOnlyKeys(candidate, ['anchor', 'beat'], 'timeline annotation resize coordinate');
		return { anchor: 'musical', beat: canonicalCoordinate(candidate.beat, 'annotation resize beat') };
	}
	throw new RangeError('Timeline annotation resize coordinate anchor must be sample or musical.');
}

function conversionCoordinates(value: unknown): TimelineAnnotationConversionCoordinates {
	const candidate = assertOnlyKeys(
		commandRecord(value, 'timeline annotation conversion coordinates'),
		['kind', 'anchor', 'positionFrame', 'positionBeat', 'startFrame', 'endFrame', 'startBeat', 'endBeat'],
		'timeline annotation conversion coordinates',
	);
	if (candidate.kind === 'marker' && candidate.anchor === 'sample') {
		assertOnlyKeys(candidate, ['kind', 'anchor', 'positionFrame'], 'timeline annotation conversion coordinates');
		return {
			kind: 'marker', anchor: 'sample',
			positionFrame: nonNegativeSafeInteger(candidate.positionFrame, 'annotation conversion positionFrame'),
		};
	}
	if (candidate.kind === 'marker' && candidate.anchor === 'musical') {
		assertOnlyKeys(candidate, ['kind', 'anchor', 'positionBeat'], 'timeline annotation conversion coordinates');
		return {
			kind: 'marker', anchor: 'musical',
			positionBeat: canonicalCoordinate(candidate.positionBeat, 'annotation conversion positionBeat'),
		};
	}
	if (candidate.kind === 'region' && candidate.anchor === 'sample') {
		assertOnlyKeys(
			candidate,
			['kind', 'anchor', 'startFrame', 'endFrame'],
			'timeline annotation conversion coordinates',
		);
		return {
			kind: 'region', anchor: 'sample',
			startFrame: nonNegativeSafeInteger(candidate.startFrame, 'annotation conversion startFrame'),
			endFrame: nonNegativeSafeInteger(candidate.endFrame, 'annotation conversion endFrame'),
		};
	}
	if (candidate.kind === 'region' && candidate.anchor === 'musical') {
		assertOnlyKeys(
			candidate,
			['kind', 'anchor', 'startBeat', 'endBeat'],
			'timeline annotation conversion coordinates',
		);
		return {
			kind: 'region', anchor: 'musical',
			startBeat: canonicalCoordinate(candidate.startBeat, 'annotation conversion startBeat'),
			endBeat: canonicalCoordinate(candidate.endBeat, 'annotation conversion endBeat'),
		};
	}
	throw new RangeError('Timeline annotation conversion coordinates require a supported kind and anchor.');
}

function canonicalCoordinate(value: unknown, name: string): Rational {
	const candidate = assertOnlyKeys(commandRecord(value, name), ['num', 'den'], name);
	const num = nonNegativeSafeInteger(candidate.num, `${name}.num`);
	const den = positiveSafeInteger(candidate.den, `${name}.den`);
	return exactNormalizedRational(num, den, name);
}

function canonicalDelta(value: unknown, name: string): Rational {
	const candidate = assertOnlyKeys(commandRecord(value, name), ['num', 'den'], name);
	const num = safeInteger(candidate.num, `${name}.num`);
	const den = positiveSafeInteger(candidate.den, `${name}.den`);
	return exactNormalizedRational(num, den, name);
}

function exactNormalizedRational(num: number, den: number, name: string): Rational {
	const normalized = normalizeRational({ num, den }, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
	if (normalized.num !== num || normalized.den !== den) throw new RangeError(`${name} must be canonically reduced.`);
	return normalized;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = BigInt(left) + BigInt(right);
	if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`${name} exceeds the safe integer domain.`);
	}
	return Number(result);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function commandRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	return value as DataRecord;
}

function assertOnlyKeys(value: DataRecord, keys: readonly string[], name: string): DataRecord {
	const allowed = new Set(keys);
	const snapshot: DataRecord = Object.create(null) as DataRecord;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

