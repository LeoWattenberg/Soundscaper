/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import type { FramescaperMulticameraCommandSequence } from './editor-project-sequence-multicam.ts';
import type { FramescaperSequenceCommandSequence } from './editor-project-sequence-sequence.ts';

export const FRAMESCAPER_SEQUENCE_MAXIMUM_NESTING_DEPTH = 32;
export const FRAMESCAPER_SEQUENCE_MAXIMUM_SUBSEQUENCES = 4_096;

/**
 * Bound the flattened expansion the subsequence and depth fences leave unbounded:
 * a validated diamond graph enumerates one occurrence per distinct root-to-leaf path.
 * The budget counts one unit per traversed sequence plus one per emitted occurrence.
 */
export const FRAMESCAPER_SEQUENCE_MAXIMUM_FLATTENED_OCCURRENCES = 65_536;

export interface FramescaperSubsequenceSequence extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sequenceId: string;
	readonly sourceSequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
}

export type FramescaperSubsequenceChangesSequence = Readonly<Partial<
	Omit<FramescaperSubsequenceSequence, 'id'>
>>;

export type FramescaperSubsequenceCommandSequence =
	| Readonly<{ readonly type: 'subsequence/add'; readonly subsequence: FramescaperSubsequenceSequence }>
	| Readonly<{
		readonly type: 'subsequence/update';
		readonly subsequenceId: string;
		readonly changes: FramescaperSubsequenceChangesSequence;
	}>
	| Readonly<{ readonly type: 'subsequence/remove'; readonly subsequenceId: string }>;

export type FramescaperProjectCommandSequence =
	| AudioEditorCommand
	| FramescaperSequenceCommandSequence
	| FramescaperSubsequenceCommandSequence
	| FramescaperMulticameraCommandSequence;

interface SequenceRate {
	readonly num: number;
	readonly den: number;
}

const SUBSEQUENCE_FIELDS = new Set([
	'id', 'sequenceId', 'sourceSequenceId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
]);

/** Validate the exact persisted sequence subsequence graph after the V17 foundation. */
export function validateFramescaperSubsequencesSequence(
	profile: unknown,
	projectValue: unknown,
): readonly FramescaperSubsequenceSequence[] {
	assertFramescaperProjectSequenceProfile(profile);
	const project = dataRecord(projectValue, 'Framescaper sequence project');
	const sequenceValues = denseArray(dataProperty(project, 'sequences', 'Framescaper sequence project'), 'sequences');
	const sequenceRates = new Map<string, SequenceRate>();
	const sequenceTrackIds = new Map<string, readonly string[]>();
	for (const [index, value] of sequenceValues.entries()) {
		const sequence = dataRecord(value, `sequence ${String(index)}`);
		const id = nonEmptyString(dataProperty(sequence, 'id', `sequence ${String(index)}`), 'sequence ID');
		const rate = dataRecord(dataProperty(sequence, 'rate', `sequence ${id}`), `sequence ${id}.rate`);
		sequenceRates.set(id, {
			num: positiveSafeInteger(dataProperty(rate, 'num', `sequence ${id}.rate`), `sequence ${id}.rate.num`),
			den: positiveSafeInteger(dataProperty(rate, 'den', `sequence ${id}.rate`), `sequence ${id}.rate.den`),
		});
		sequenceTrackIds.set(id, optionalStringArray(sequence, 'trackIds'));
	}
	const subsequencesDescriptor = Object.getOwnPropertyDescriptor(project, 'subsequences');
	if (!subsequencesDescriptor?.enumerable || !Object.hasOwn(subsequencesDescriptor, 'value')) {
		throw new TypeError('Framescaper sequence project.subsequences must be an own enumerable data property.');
	}
	const values = denseArray(subsequencesDescriptor.value, 'Framescaper sequence project.subsequences');
	if (values.length > FRAMESCAPER_SEQUENCE_MAXIMUM_SUBSEQUENCES) {
		throw new RangeError('Framescaper sequence subsequences exceed the maintained limit.');
	}
	const ids = new Set<string>();
	const outgoing = new Map<string, string[]>();
	const result: FramescaperSubsequenceSequence[] = [];
	for (const [index, value] of values.entries()) {
		const name = `Framescaper sequence subsequences[${String(index)}]`;
		const candidate = exactDataRecord(value, SUBSEQUENCE_FIELDS, name);
		const subsequence: FramescaperSubsequenceSequence = {
			id: nonEmptyString(dataProperty(candidate, 'id', name), `${name}.id`),
			sequenceId: nonEmptyString(dataProperty(candidate, 'sequenceId', name), `${name}.sequenceId`),
			sourceSequenceId: nonEmptyString(
				dataProperty(candidate, 'sourceSequenceId', name),
				`${name}.sourceSequenceId`,
			),
			sequenceStartFrame: nonNegativeSafeInteger(
				dataProperty(candidate, 'sequenceStartFrame', name),
				`${name}.sequenceStartFrame`,
			),
			sequenceFrameCount: positiveSafeInteger(
				dataProperty(candidate, 'sequenceFrameCount', name),
				`${name}.sequenceFrameCount`,
			),
			sourceInFrame: nonNegativeSafeInteger(
				dataProperty(candidate, 'sourceInFrame', name),
				`${name}.sourceInFrame`,
			),
			sourceFrameCount: positiveSafeInteger(
				dataProperty(candidate, 'sourceFrameCount', name),
				`${name}.sourceFrameCount`,
			),
		};
		if (ids.has(subsequence.id)) throw new RangeError(`Duplicate subsequence ID: ${subsequence.id}.`);
		ids.add(subsequence.id);
		const parentRate = sequenceRates.get(subsequence.sequenceId);
		const sourceRate = sequenceRates.get(subsequence.sourceSequenceId);
		if (!parentRate) throw new ReferenceError(`Subsequence ${subsequence.id} references a missing parent sequence.`);
		if (!sourceRate) throw new ReferenceError(`Subsequence ${subsequence.id} references a missing source sequence.`);
		safeSum(subsequence.sequenceStartFrame, subsequence.sequenceFrameCount, `${name} parent range`);
		safeSum(subsequence.sourceInFrame, subsequence.sourceFrameCount, `${name} source range`);
		assertExactDuration(subsequence, parentRate, sourceRate);
		const children = outgoing.get(subsequence.sequenceId) ?? [];
		children.push(subsequence.sourceSequenceId);
		outgoing.set(subsequence.sequenceId, children);
		result.push(subsequence);
	}
	assertAcyclic(sequenceRates.keys(), outgoing);
	assertMaximumDepth(sequenceRates.keys(), outgoing);
	assertFramescaperFlatteningBudgetSequence(
		sequenceRates.keys(),
		outgoing,
		sequenceClipCounts(project, sequenceTrackIds),
	);
	return result;
}

export function isFramescaperSubsequenceCommandSequence(
	value: FramescaperProjectCommandSequence | unknown,
): value is FramescaperSubsequenceCommandSequence {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& (descriptor.value === 'subsequence/add'
			|| descriptor.value === 'subsequence/update'
			|| descriptor.value === 'subsequence/remove'),
	);
}

/** Fence the flattened expansion of an acyclic depth-fenced graph without enumerating its paths. */
export function assertFramescaperFlatteningBudgetSequence(
	sequenceIds: Iterable<string>,
	outgoing: ReadonlyMap<string, readonly string[]>,
	clipCounts: ReadonlyMap<string, number>,
): void {
	const ceiling = FRAMESCAPER_SEQUENCE_MAXIMUM_FLATTENED_OCCURRENCES + 1;
	const costs = new Map<string, number>();
	const cost = (sequenceId: string): number => {
		const prior = costs.get(sequenceId);
		if (prior !== undefined) return prior;
		let result = 1 + (clipCounts.get(sequenceId) ?? 0);
		for (const child of outgoing.get(sequenceId) ?? []) result = Math.min(result + cost(child), ceiling);
		costs.set(sequenceId, result);
		return result;
	};
	for (const sequenceId of sequenceIds) {
		if (cost(sequenceId) > FRAMESCAPER_SEQUENCE_MAXIMUM_FLATTENED_OCCURRENCES) {
			throw new RangeError('Framescaper sequence nested flattening exceeds the maintained occurrence limit.');
		}
	}
}

function assertExactDuration(
	value: FramescaperSubsequenceSequence,
	parentRate: SequenceRate,
	sourceRate: SequenceRate,
): void {
	const parentDuration = BigInt(value.sequenceFrameCount)
		* BigInt(parentRate.den) * BigInt(sourceRate.num);
	const sourceDuration = BigInt(value.sourceFrameCount)
		* BigInt(sourceRate.den) * BigInt(parentRate.num);
	if (parentDuration !== sourceDuration) {
		throw new RangeError(`Subsequence ${value.id} must preserve an exact real-time duration.`);
	}
}

function assertAcyclic(sequenceIds: Iterable<string>, outgoing: ReadonlyMap<string, readonly string[]>): void {
	const states = new Map<string, 1 | 2>();
	const visit = (sequenceId: string): void => {
		if (states.get(sequenceId) === 1) throw new RangeError('Framescaper sequence subsequences contain a cycle.');
		if (states.get(sequenceId) === 2) return;
		states.set(sequenceId, 1);
		for (const child of outgoing.get(sequenceId) ?? []) visit(child);
		states.set(sequenceId, 2);
	};
	for (const sequenceId of sequenceIds) visit(sequenceId);
}

function assertMaximumDepth(
	sequenceIds: Iterable<string>,
	outgoing: ReadonlyMap<string, readonly string[]>,
): void {
	const depths = new Map<string, number>();
	const depth = (sequenceId: string): number => {
		const prior = depths.get(sequenceId);
		if (prior !== undefined) return prior;
		let result = 0;
		for (const child of outgoing.get(sequenceId) ?? []) result = Math.max(result, depth(child) + 1);
		if (result > FRAMESCAPER_SEQUENCE_MAXIMUM_NESTING_DEPTH) {
			throw new RangeError('Framescaper sequence subsequences exceed the maximum nesting depth.');
		}
		depths.set(sequenceId, result);
		return result;
	};
	for (const sequenceId of sequenceIds) depth(sequenceId);
}

/**
 * Track and occurrence shape belongs to the V17 foundation, which runs after this fence:
 * unresolved shapes contribute no occurrences here and are refused before anything persists.
 */
function sequenceClipCounts(
	project: Record<string, unknown>,
	sequenceTrackIds: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
	const trackClipCounts = new Map<string, number>();
	for (const value of optionalArray(project, 'tracks')) {
		const track = optionalRecord(value);
		if (!track) continue;
		const id = optionalValue(track, 'id');
		if (typeof id === 'string') trackClipCounts.set(id, optionalArray(track, 'clipIds').length);
	}
	const counts = new Map<string, number>();
	for (const [sequenceId, trackIds] of sequenceTrackIds) {
		let count = 0;
		for (const trackId of trackIds) count += trackClipCounts.get(trackId) ?? 0;
		counts.set(sequenceId, count);
	}
	return counts;
}

function optionalStringArray(value: object, key: string): readonly string[] {
	return optionalArray(value, key).filter((entry): entry is string => typeof entry === 'string');
}

function optionalArray(value: object, key: string): readonly unknown[] {
	const candidate = optionalValue(value, key);
	return Array.isArray(candidate) ? candidate : [];
}

function optionalValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactDataRecord(value: unknown, fields: ReadonlySet<string>, name: string): Record<string, unknown> {
	const record = dataRecord(value, name);
	for (const key of Reflect.ownKeys(record)) {
		if (typeof key !== 'string' || !fields.has(key)) throw new TypeError(`${name} has an unsupported field.`);
	}
	for (const field of fields) dataProperty(record, field, name);
	return record;
}

function denseArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
		throw new TypeError(`${name} must be a dense data array.`);
	}
	for (let index = 0; index < value.length; index += 1) dataProperty(value, String(index), name);
	return value;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe-integer range.`);
	return result;
}
