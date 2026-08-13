/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectV18 } from './editor-project-v18-validation.ts';

export interface FramescaperSequenceRateV18 {
	readonly num: number;
	readonly den: number;
}

export interface FramescaperSequenceTimecodeV18 {
	readonly negative: boolean;
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly frames: number;
}

/** New V18 sequences are deliberately empty; track ownership remains with track commands. */
export interface FramescaperSequenceV18 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly rate: Readonly<FramescaperSequenceRateV18>;
	readonly dropFrame: boolean;
	readonly startTimecode: Readonly<FramescaperSequenceTimecodeV18>;
	readonly trackIds: readonly string[];
	readonly trackNodes: readonly Readonly<Record<string, unknown>>[];
}

export type FramescaperSequenceCommandV18 =
	| Readonly<{ readonly type: 'sequence/create'; readonly sequence: FramescaperSequenceV18 }>
	| Readonly<{ readonly type: 'sequence/delete'; readonly sequenceId: string }>;

const SEQUENCE_FIELDS = new Set([
	'id', 'name', 'rate', 'dropFrame', 'startTimecode', 'trackIds', 'trackNodes',
]);
const RATE_FIELDS = new Set(['num', 'den']);
const TIMECODE_FIELDS = new Set(['negative', 'hours', 'minutes', 'seconds', 'frames']);

export function isFramescaperSequenceCommandV18(value: unknown): value is FramescaperSequenceCommandV18 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& (descriptor.value === 'sequence/create' || descriptor.value === 'sequence/delete'),
	);
}

/** Snapshot one exact empty sequence before it enters command or history state. */
export function snapshotFramescaperSequenceV18(value: unknown): Readonly<FramescaperSequenceV18> {
	const sequence = exactRecord(value, SEQUENCE_FIELDS, 'Framescaper V18 sequence');
	const rate = exactRecord(data(sequence, 'rate'), RATE_FIELDS, 'Framescaper V18 sequence.rate');
	const timecode = exactRecord(
		data(sequence, 'startTimecode'),
		TIMECODE_FIELDS,
		'Framescaper V18 sequence.startTimecode',
	);
	emptyArray(data(sequence, 'trackIds'), 'Framescaper V18 sequence.trackIds');
	emptyArray(data(sequence, 'trackNodes'), 'Framescaper V18 sequence.trackNodes');
	return Object.freeze({
		id: identifier(data(sequence, 'id'), 'sequence ID'),
		name: identifier(data(sequence, 'name'), 'sequence name'),
		rate: Object.freeze({
			num: positiveInteger(data(rate, 'num'), 'sequence rate numerator'),
			den: positiveInteger(data(rate, 'den'), 'sequence rate denominator'),
		}),
		dropFrame: boolean(data(sequence, 'dropFrame'), 'sequence dropFrame'),
		startTimecode: Object.freeze({
			negative: boolean(data(timecode, 'negative'), 'sequence timecode negative'),
			hours: nonNegativeInteger(data(timecode, 'hours'), 'sequence timecode hours'),
			minutes: nonNegativeInteger(data(timecode, 'minutes'), 'sequence timecode minutes'),
			seconds: nonNegativeInteger(data(timecode, 'seconds'), 'sequence timecode seconds'),
			frames: nonNegativeInteger(data(timecode, 'frames'), 'sequence timecode frames'),
		}),
		trackIds: Object.freeze([]),
		trackNodes: Object.freeze([]),
	});
}

export function framescaperSequenceIdV18(value: unknown): string {
	return identifier(value, 'sequence ID');
}

/** Refuse every known ownership edge before removing one secondary sequence. */
export function assertFramescaperSequenceDeletionV18(
	project: FramescaperProjectV18,
	sequenceId: string,
): void {
	if (sequenceId === project.primarySequenceId) {
		throw new RangeError('The primary sequence cannot be deleted.');
	}
	const sequence = project.sequences.find(({ id }) => id === sequenceId);
	if (!sequence) throw new ReferenceError(`Sequence ${sequenceId} is missing.`);
	if (nonEmptyArray(sequence.trackIds) || nonEmptyArray(sequence.trackNodes)) {
		throw new RangeError(`Sequence ${sequenceId} is not empty and cannot be deleted.`);
	}
	if (project.subsequences.some((placement) => (
		placement.sequenceId === sequenceId || placement.sourceSequenceId === sequenceId
	))) {
		throw new RangeError(`Sequence ${sequenceId} is referenced by a nested placement.`);
	}
	if (project.multicameraGroups.some((group) => group.sequenceId === sequenceId)) {
		throw new RangeError(`Sequence ${sequenceId} is referenced by a multicamera group.`);
	}
	if (referencesSequence(project.clips, sequenceId)
		|| referencesSequence(projectBinClips(project), sequenceId)) {
		throw new RangeError(`Sequence ${sequenceId} is referenced by a clip.`);
	}
	if (referencesSequence(recordArray(project.timelineAnnotations), sequenceId)) {
		throw new RangeError(`Sequence ${sequenceId} is referenced by a timeline annotation.`);
	}
	if (referencesSequence(recordArray(project.takeGroups), sequenceId)) {
		throw new RangeError(`Sequence ${sequenceId} is referenced by a take group.`);
	}
}

function referencesSequence(values: readonly Readonly<Record<string, unknown>>[], sequenceId: string): boolean {
	return values.some((value) => value.sequenceId === sequenceId);
}

function projectBinClips(project: FramescaperProjectV18): readonly Readonly<Record<string, unknown>>[] {
	const bin = project.projectBin;
	return bin && typeof bin === 'object' && !Array.isArray(bin)
		? recordArray((bin as Readonly<Record<string, unknown>>).clips)
		: [];
}

function recordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return Array.isArray(value)
		? value.filter((item): item is Readonly<Record<string, unknown>> => (
			Boolean(item) && typeof item === 'object' && !Array.isArray(item)
		))
		: [];
}

function nonEmptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length > 0;
}

function exactRecord(value: unknown, fields: ReadonlySet<string>, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`${name} must be an exact plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.size
		|| keys.some((key) => typeof key !== 'string' || !fields.has(key))) {
		throw new TypeError(`${name} has an unsupported field or is not exact.`);
	}
	for (const field of fields) data(value, field);
	return value as Record<string, unknown>;
}

function data(value: object, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Framescaper V18 ${field} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function emptyArray(value: unknown, name: string): void {
	if (!Array.isArray(value) || value.length !== 0 || Reflect.ownKeys(value).length !== 1) {
		throw new RangeError(`${name} must be an empty dense array.`);
	}
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`Framescaper V18 ${name} must be a non-empty string.`);
	}
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`Framescaper V18 ${name} must be boolean.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`Framescaper V18 ${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`Framescaper V18 ${name} must be a positive safe integer.`);
	}
	return Number(value);
}
