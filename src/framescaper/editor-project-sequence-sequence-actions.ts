/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperProjectCommandSequence,
	FramescaperSubsequenceChangesSequence,
	FramescaperSubsequenceSequence,
} from './editor-project-sequence-subsequence.ts';
import {
	framescaperSequenceIdSequence,
	snapshotFramescaperSequenceSequence,
} from './editor-project-sequence-sequence.ts';

export interface FramescaperSequenceActionsSequence {
	readonly createSequence: (sequence: unknown) => unknown;
	readonly deleteSequence: (sequenceId: unknown) => unknown;
	readonly addNested: (subsequence: unknown) => unknown;
	readonly updateNested: (subsequenceId: unknown, changes: unknown) => unknown;
	readonly removeNested: (subsequenceId: unknown) => unknown;
}

/** Bind the exact sequence command spellings without exposing a generic product command port. */
export function createFramescaperSequenceActionsSequence(
	executeValue: ((command: FramescaperProjectCommandSequence) => unknown) | unknown,
): Readonly<FramescaperSequenceActionsSequence> {
	if (typeof executeValue !== 'function') {
		throw new TypeError('Framescaper nested-sequence actions require an exact command executor.');
	}
	const execute = executeValue as (command: FramescaperProjectCommandSequence) => unknown;
	return Object.freeze({
		createSequence(sequenceValue: unknown): unknown {
			return execute(Object.freeze({
				type: 'sequence/create', sequence: snapshotFramescaperSequenceSequence(sequenceValue),
			}));
		},
		deleteSequence(sequenceIdValue: unknown): unknown {
			return execute(Object.freeze({
				type: 'sequence/delete', sequenceId: framescaperSequenceIdSequence(sequenceIdValue),
			}));
		},
		addNested(subsequenceValue: unknown): unknown {
			return execute(Object.freeze({
				type: 'subsequence/add', subsequence: subsequence(subsequenceValue),
			}));
		},
		updateNested(subsequenceIdValue: unknown, changesValue: unknown): unknown {
			return execute(Object.freeze({
				type: 'subsequence/update',
				subsequenceId: identifier(subsequenceIdValue, 'subsequence ID'),
				changes: changes(changesValue),
			}));
		},
		removeNested(subsequenceIdValue: unknown): unknown {
			return execute(Object.freeze({
				type: 'subsequence/remove',
				subsequenceId: identifier(subsequenceIdValue, 'subsequence ID'),
			}));
		},
	});
}

function subsequence(value: unknown): FramescaperSubsequenceSequence {
	const result = exactFields(value, [
		'id', 'sequenceId', 'sourceSequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	], false, 'nested subsequence');
	validateFields(result, 'nested subsequence');
	return result as unknown as FramescaperSubsequenceSequence;
}

function changes(value: unknown): FramescaperSubsequenceChangesSequence {
	const result = exactFields(value, [
		'sequenceId', 'sourceSequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	], true, 'nested subsequence changes');
	if (Reflect.ownKeys(result).length === 0) {
		throw new TypeError('Framescaper nested subsequence changes must not be empty.');
	}
	validateFields(result, 'nested subsequence changes');
	return result as FramescaperSubsequenceChangesSequence;
}

function exactFields(
	value: unknown,
	fields: readonly string[],
	partial: boolean,
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const input = value as Record<string, unknown>;
	const allowed = new Set(fields);
	for (const key of Reflect.ownKeys(input)) {
		if (typeof key !== 'string' || !allowed.has(key)) throw new TypeError(`${name} has an unsupported field.`);
	}
	const output: Record<string, unknown> = {};
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(input, field);
		if (!descriptor) {
			if (!partial) throw new TypeError(`${name}.${field} is required.`);
			continue;
		}
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
		output[field] = descriptor.value;
	}
	return Object.freeze(output);
}

function validateFields(value: Readonly<Record<string, unknown>>, name: string): void {
	for (const field of ['id', 'sequenceId', 'sourceSequenceId']) {
		if (Object.hasOwn(value, field)) identifier(value[field], `${name}.${field}`);
	}
	for (const field of ['sequenceStartFrame', 'sourceInFrame']) {
		if (Object.hasOwn(value, field)) integer(value[field], 0, `${name}.${field}`);
	}
	for (const field of ['sequenceFrameCount', 'sourceFrameCount']) {
		if (Object.hasOwn(value, field)) integer(value[field], 1, `${name}.${field}`);
	}
	if (Object.hasOwn(value, 'sequenceStartFrame') && Object.hasOwn(value, 'sequenceFrameCount')) {
		safeSum(value.sequenceStartFrame, value.sequenceFrameCount, `${name} parent range`);
	}
	if (Object.hasOwn(value, 'sourceInFrame') && Object.hasOwn(value, 'sourceFrameCount')) {
		safeSum(value.sourceInFrame, value.sourceFrameCount, `${name} source range`);
	}
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`Framescaper ${name} must be a non-empty string.`);
	return value;
}

function integer(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`Framescaper ${name} must be a safe integer of at least ${String(minimum)}.`);
	}
	return Number(value);
}

function safeSum(left: unknown, right: unknown, name: string): void {
	if (!Number.isSafeInteger(Number(left) + Number(right))) {
		throw new RangeError(`Framescaper ${name} exceeds the safe-integer range.`);
	}
}
