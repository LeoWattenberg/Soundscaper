/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddTimelineAnnotationCommand } from '../commands/factories.ts';
import type { BatchAudioEditorCommand } from '../commands/protocol.ts';
import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationV11,
	type TimelineAnnotationColor,
	type TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from '../timeline-coordinate-limits.ts';
import {
	addRationals,
	compareRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
	type RationalInput,
} from '../timeline-time.ts';

interface RegularIntervalProject {
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly sequences: readonly Readonly<Record<string, unknown>>[];
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
}

interface RegularIntervalCommonOptions {
	readonly kind: 'marker' | 'region';
	readonly sequenceId: string;
	readonly namePrefix: string;
	readonly color: TimelineAnnotationColor;
}

export interface SampleRegularIntervalAnnotationOptions extends RegularIntervalCommonOptions {
	readonly anchor: 'sample';
	readonly startFrame: number;
	readonly endFrame: number;
	readonly intervalFrames: number;
	readonly includeEnd?: boolean;
}

export interface MusicalRegularIntervalAnnotationOptions extends RegularIntervalCommonOptions {
	readonly anchor: 'musical';
	readonly startBeat: RationalInput;
	readonly endBeat: RationalInput;
	readonly intervalBeats: RationalInput;
	readonly includeEnd?: boolean;
}

export type RegularIntervalAnnotationOptions =
	| SampleRegularIntervalAnnotationOptions
	| MusicalRegularIntervalAnnotationOptions;

export interface RegularIntervalAnnotationPlan {
	readonly command: BatchAudioEditorCommand;
	readonly annotationIds: readonly string[];
	readonly batchId: string;
}

type StableIdFactory = (prefix: string) => string;
type SampleInterval = Readonly<{ readonly startFrame: number; readonly endFrame?: number }>;
type MusicalInterval = Readonly<{ readonly startBeat: Rational; readonly endBeat?: Rational }>;

const COMMON_OPTION_KEYS = ['kind', 'anchor', 'sequenceId', 'namePrefix', 'color'] as const;
const SAMPLE_OPTION_KEYS = new Set([...COMMON_OPTION_KEYS, 'startFrame', 'endFrame', 'intervalFrames', 'includeEnd']);
const MUSICAL_OPTION_KEYS = new Set([...COMMON_OPTION_KEYS, 'startBeat', 'endBeat', 'intervalBeats', 'includeEnd']);

/** Build one undoable command that creates a stable batch of regular annotations. */
export function createRegularIntervalAnnotationCommand(
	project: RegularIntervalProject,
	options: RegularIntervalAnnotationOptions,
	createId: StableIdFactory,
): RegularIntervalAnnotationPlan {
	assertProject(project);
	assertOptions(options);
	if (typeof createId !== 'function') throw new TypeError('A stable annotation ID factory is required.');
	const capacity = AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations
		- project.timelineAnnotations.length;
	if (capacity < 1) throw new RangeError('Timeline annotation capacity is exhausted.');
	if (!project.sequences.some(({ id }) => id === options.sequenceId)) {
		throw new RangeError(`Timeline annotation sequence ${options.sequenceId} does not exist.`);
	}
	const coordinates = options.anchor === 'sample'
		? sampleIntervals(options, capacity)
		: musicalIntervals(options, capacity);
	const existingIds = new Set(project.timelineAnnotations.map(({ id }) => id));
	const batchId = nextUniqueId(createId, 'timeline-annotation-batch', existingIds, 'batch');
	existingIds.add(batchId);
	const context = { tempoMap: project.tempoMap, sampleRate: project.sampleRate };
	const annotationIds: string[] = [];
	const commands = coordinates.map((coordinate, index) => {
		const id = nextUniqueId(createId, 'timeline-annotation', existingIds, 'annotation');
		existingIds.add(id);
		annotationIds.push(id);
		const common = {
			id,
			sequenceId: options.sequenceId,
			name: intervalName(options.namePrefix, index + 1),
			color: options.color,
			batchId,
			opaqueExtensions: {},
		};
		const annotation = createTimelineAnnotationV11({
			...common,
			kind: options.kind,
			anchor: options.anchor,
			...(options.anchor === 'sample'
				? sampleAnnotationCoordinates(options.kind, coordinate as SampleInterval)
				: musicalAnnotationCoordinates(options.kind, coordinate as MusicalInterval)),
		}, context);
		return Object.freeze(createAddTimelineAnnotationCommand(annotation));
	});
	return Object.freeze({
		command: Object.freeze({ type: 'batch', commands: Object.freeze(commands) }),
		annotationIds: Object.freeze(annotationIds),
		batchId,
	});
}

function sampleIntervals(
	options: SampleRegularIntervalAnnotationOptions,
	capacity: number,
): readonly SampleInterval[] {
	const start = nonNegativeSafeInteger(options.startFrame, 'regular interval start frame');
	const end = nonNegativeSafeInteger(options.endFrame, 'regular interval end frame');
	const interval = positiveSafeInteger(options.intervalFrames, 'regular interval frame interval');
	if (end <= start) throw new RangeError('The regular interval sample range must be positive.');
	const includeEnd = markerIncludesEnd(options);
	const result: SampleInterval[] = [];
	for (let position = BigInt(start);;) {
		const comparison = position - BigInt(end);
		if (comparison > 0n || (comparison === 0n && !includeEnd)) break;
		if (result.length >= capacity) throw capacityError();
		const startFrame = Number(position);
		if (options.kind === 'marker') result.push(Object.freeze({ startFrame }));
		else {
			if (position === BigInt(end)) break;
			const next = position + BigInt(interval);
			result.push(Object.freeze({ startFrame, endFrame: Number(next < BigInt(end) ? next : BigInt(end)) }));
		}
		position += BigInt(interval);
	}
	return Object.freeze(result);
}

function musicalIntervals(
	options: MusicalRegularIntervalAnnotationOptions,
	capacity: number,
): readonly MusicalInterval[] {
	const rationalOptions = { maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR };
	const start = normalizeRational(options.startBeat, rationalOptions);
	const end = normalizeRational(options.endBeat, rationalOptions);
	const interval = normalizeRational(options.intervalBeats, rationalOptions);
	if (compareRationals(start, end) >= 0) {
		throw new RangeError('The regular interval musical range must be positive.');
	}
	if (compareRationals(interval, 0) <= 0) {
		throw new RangeError('The regular interval beat interval must be positive.');
	}
	const includeEnd = markerIncludesEnd(options);
	const result: MusicalInterval[] = [];
	for (let position = start;; position = addRationals(position, interval)) {
		const comparison = compareRationals(position, end);
		if (comparison > 0 || (comparison === 0 && !includeEnd)) break;
		if (result.length >= capacity) throw capacityError();
		if (options.kind === 'marker') result.push(Object.freeze({ startBeat: position }));
		else {
			if (comparison === 0) break;
			const next = addRationals(position, interval);
			result.push(Object.freeze({
				startBeat: position,
				endBeat: compareRationals(next, end) < 0 ? next : end,
			}));
		}
	}
	return Object.freeze(result);
}

function sampleAnnotationCoordinates(kind: 'marker' | 'region', interval: SampleInterval) {
	return kind === 'marker'
		? { positionFrame: interval.startFrame }
		: { startFrame: interval.startFrame, endFrame: interval.endFrame };
}

function musicalAnnotationCoordinates(kind: 'marker' | 'region', interval: MusicalInterval) {
	return kind === 'marker'
		? { positionBeat: interval.startBeat }
		: { startBeat: interval.startBeat, endBeat: interval.endBeat };
}

function markerIncludesEnd(options: RegularIntervalAnnotationOptions): boolean {
	if (options.includeEnd != null && typeof options.includeEnd !== 'boolean') {
		throw new TypeError('The regular interval includeEnd option must be boolean.');
	}
	if (options.kind === 'region' && options.includeEnd != null) {
		throw new TypeError('The regular interval includeEnd option applies only to markers.');
	}
	return options.kind === 'marker' && options.includeEnd === true;
}

function assertProject(project: RegularIntervalProject): void {
	if (!project || typeof project !== 'object'
		|| !isTimelineAnnotationProjectSchema(project.schemaVersion)) {
		throw new RangeError('Regular interval annotations require schema 11 or 12.');
	}
	if (!Array.isArray(project.timelineAnnotations)
		|| project.timelineAnnotations.length > AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations) {
		throw new RangeError('The project timeline annotation collection exceeds capacity.');
	}
	if (!Array.isArray(project.sequences) || !project.sequences.every((sequence) => (
		sequence && typeof sequence === 'object' && typeof sequence.id === 'string'
	))) {
		throw new TypeError('The project sequence graph is invalid.');
	}
}

function assertOptions(options: RegularIntervalAnnotationOptions): void {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Regular interval annotation options must be an object.');
	}
	const prototype = Object.getPrototypeOf(options);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Regular interval annotation options must be a plain record.');
	}
	const allowed = options.anchor === 'sample' ? SAMPLE_OPTION_KEYS
		: options.anchor === 'musical' ? MUSICAL_OPTION_KEYS
			: null;
	if (!allowed || Reflect.ownKeys(options).some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError('Regular interval annotation options contain an unknown field.');
	}
	for (const key of Reflect.ownKeys(options)) {
		const descriptor = Object.getOwnPropertyDescriptor(options, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) {
			throw new TypeError('Regular interval annotation options must contain enumerable data fields.');
		}
	}
	if (options.kind !== 'marker' && options.kind !== 'region') {
		throw new RangeError('Regular interval annotation kind must be marker or region.');
	}
	if (typeof options.sequenceId !== 'string'
		|| !options.sequenceId
		|| typeof options.namePrefix !== 'string') {
		throw new TypeError('Regular interval annotation identity fields are invalid.');
	}
}

function nextUniqueId(
	createId: StableIdFactory,
	prefix: string,
	used: ReadonlySet<string>,
	name: string,
): string {
	const id = createId(prefix);
	if (typeof id !== 'string' || !id || id.trim() !== id || used.has(id)) {
		throw new RangeError(`The regular interval ${name} ID is invalid or duplicate.`);
	}
	return id;
}

function intervalName(prefix: string, index: number): string {
	return prefix ? `${prefix} ${String(index)}` : String(index);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result < 1) throw new RangeError(`${name} must be positive.`);
	return result;
}

function capacityError(): RangeError {
	return new RangeError(`Regular interval annotations exceed the ${String(
		AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations,
	)} item capacity.`);
}
