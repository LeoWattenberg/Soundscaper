/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import type { FramescaperMulticameraCommandV18 } from './editor-project-v18-multicam.ts';
import type { FramescaperSequenceCommandV18 } from './editor-project-v18-sequence.ts';

export const FRAMESCAPER_V18_MAXIMUM_NESTING_DEPTH = 32;
export const FRAMESCAPER_V18_MAXIMUM_SUBSEQUENCES = 4_096;

export interface FramescaperSubsequenceV18 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sequenceId: string;
	readonly sourceSequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
}

export type FramescaperSubsequenceChangesV18 = Readonly<Partial<
	Omit<FramescaperSubsequenceV18, 'id'>
>>;

export type FramescaperSubsequenceCommandV18 =
	| Readonly<{ readonly type: 'subsequence/add'; readonly subsequence: FramescaperSubsequenceV18 }>
	| Readonly<{
		readonly type: 'subsequence/update';
		readonly subsequenceId: string;
		readonly changes: FramescaperSubsequenceChangesV18;
	}>
	| Readonly<{ readonly type: 'subsequence/remove'; readonly subsequenceId: string }>;

export type FramescaperProjectCommandV18 =
	| AudioEditorCommand
	| FramescaperSequenceCommandV18
	| FramescaperSubsequenceCommandV18
	| FramescaperMulticameraCommandV18;

interface SequenceRate {
	readonly num: number;
	readonly den: number;
}

const SUBSEQUENCE_FIELDS = new Set([
	'id', 'sequenceId', 'sourceSequenceId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
]);

/** Validate the exact persisted V18 subsequence graph after the V17 foundation. */
export function validateFramescaperSubsequencesV18(
	profile: unknown,
	projectValue: unknown,
): readonly FramescaperSubsequenceV18[] {
	assertFramescaperProjectV18Profile(profile);
	const project = dataRecord(projectValue, 'Framescaper V18 project');
	const sequenceValues = denseArray(dataProperty(project, 'sequences', 'Framescaper V18 project'), 'sequences');
	const sequenceRates = new Map<string, SequenceRate>();
	for (const [index, value] of sequenceValues.entries()) {
		const sequence = dataRecord(value, `sequence ${String(index)}`);
		const id = nonEmptyString(dataProperty(sequence, 'id', `sequence ${String(index)}`), 'sequence ID');
		const rate = dataRecord(dataProperty(sequence, 'rate', `sequence ${id}`), `sequence ${id}.rate`);
		sequenceRates.set(id, {
			num: positiveSafeInteger(dataProperty(rate, 'num', `sequence ${id}.rate`), `sequence ${id}.rate.num`),
			den: positiveSafeInteger(dataProperty(rate, 'den', `sequence ${id}.rate`), `sequence ${id}.rate.den`),
		});
	}
	const subsequencesDescriptor = Object.getOwnPropertyDescriptor(project, 'subsequences');
	if (!subsequencesDescriptor?.enumerable || !Object.hasOwn(subsequencesDescriptor, 'value')) {
		throw new TypeError('Framescaper V18 project.subsequences must be an own enumerable data property.');
	}
	const values = denseArray(subsequencesDescriptor.value, 'Framescaper V18 project.subsequences');
	if (values.length > FRAMESCAPER_V18_MAXIMUM_SUBSEQUENCES) {
		throw new RangeError('Framescaper V18 subsequences exceed the maintained limit.');
	}
	const ids = new Set<string>();
	const outgoing = new Map<string, string[]>();
	const result: FramescaperSubsequenceV18[] = [];
	for (const [index, value] of values.entries()) {
		const name = `Framescaper V18 subsequences[${String(index)}]`;
		const candidate = exactDataRecord(value, SUBSEQUENCE_FIELDS, name);
		const subsequence: FramescaperSubsequenceV18 = {
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
	return result;
}

export function isFramescaperSubsequenceCommandV18(
	value: FramescaperProjectCommandV18 | unknown,
): value is FramescaperSubsequenceCommandV18 {
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

function assertExactDuration(
	value: FramescaperSubsequenceV18,
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
		if (states.get(sequenceId) === 1) throw new RangeError('Framescaper V18 subsequences contain a cycle.');
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
		if (result > FRAMESCAPER_V18_MAXIMUM_NESTING_DEPTH) {
			throw new RangeError('Framescaper V18 subsequences exceed the maximum nesting depth.');
		}
		depths.set(sequenceId, result);
		return result;
	};
	for (const sequenceId of sequenceIds) depth(sequenceId);
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
