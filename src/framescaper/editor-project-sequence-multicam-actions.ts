/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperMulticameraCommandSequence,
	FramescaperMulticameraGroupSequence,
	FramescaperMulticameraMemberSequence,
} from './editor-project-sequence-multicam.ts';
import type { FramescaperProjectCommandSequence } from './editor-project-sequence-subsequence.ts';

export interface FramescaperMulticameraActionsSequence {
	readonly createMulticamera: (
		projectId: unknown,
		expectedProjectRevision: unknown,
		group: unknown,
	) => unknown;
	readonly updateMulticamera: (
		projectId: unknown,
		expectedProjectRevision: unknown,
		groupId: unknown,
		expectedActiveMemberId: unknown,
		group: unknown,
	) => unknown;
	readonly removeMulticamera: (
		projectId: unknown,
		expectedProjectRevision: unknown,
		groupId: unknown,
		expectedActiveMemberId: unknown,
	) => unknown;
	readonly switchMulticamera: (
		projectId: unknown,
		expectedProjectRevision: unknown,
		groupId: unknown,
		expectedActiveMemberId: unknown,
		memberId: unknown,
	) => unknown;
}

const GROUP_FIELDS = ['id', 'projectId', 'sequenceId', 'outputClipId', 'activeMemberId', 'members'] as const;
const MEMBER_FIELDS = ['id', 'groupId', 'sourceId', 'syncOffsetSamples'] as const;

/** Bind the exact sequence multicamera command spellings without a generic command escape hatch. */
export function createFramescaperMulticameraActionsSequence(
	executeValue: ((command: FramescaperProjectCommandSequence) => unknown) | unknown,
): Readonly<FramescaperMulticameraActionsSequence> {
	if (typeof executeValue !== 'function') {
		throw new TypeError('Framescaper multicamera actions require an exact command executor.');
	}
	const execute = executeValue as (command: FramescaperProjectCommandSequence) => unknown;
	return Object.freeze({
		createMulticamera(projectIdValue: unknown, revisionValue: unknown, groupValue: unknown): unknown {
			return execute(Object.freeze({
				type: 'multicamera/create',
				projectId: identifier(projectIdValue, 'project ID'),
				expectedProjectRevision: revision(revisionValue),
				group: group(groupValue),
			} satisfies FramescaperMulticameraCommandSequence));
		},
		updateMulticamera(
			projectIdValue: unknown,
			revisionValue: unknown,
			groupIdValue: unknown,
			activeMemberIdValue: unknown,
			groupValue: unknown,
		): unknown {
			return execute(Object.freeze({
				type: 'multicamera/update',
				...existingFence(projectIdValue, revisionValue, groupIdValue, activeMemberIdValue),
				group: group(groupValue),
			} satisfies FramescaperMulticameraCommandSequence));
		},
		removeMulticamera(
			projectIdValue: unknown,
			revisionValue: unknown,
			groupIdValue: unknown,
			activeMemberIdValue: unknown,
		): unknown {
			return execute(Object.freeze({
				type: 'multicamera/remove',
				...existingFence(projectIdValue, revisionValue, groupIdValue, activeMemberIdValue),
			} satisfies FramescaperMulticameraCommandSequence));
		},
		switchMulticamera(
			projectIdValue: unknown,
			revisionValue: unknown,
			groupIdValue: unknown,
			activeMemberIdValue: unknown,
			memberIdValue: unknown,
		): unknown {
			return execute(Object.freeze({
				type: 'multicamera/switch',
				...existingFence(projectIdValue, revisionValue, groupIdValue, activeMemberIdValue),
				memberId: identifier(memberIdValue, 'member ID'),
			} satisfies FramescaperMulticameraCommandSequence));
		},
	});
}

function existingFence(
	projectIdValue: unknown,
	revisionValue: unknown,
	groupIdValue: unknown,
	activeMemberIdValue: unknown,
) {
	return {
		projectId: identifier(projectIdValue, 'project ID'),
		expectedProjectRevision: revision(revisionValue),
		groupId: identifier(groupIdValue, 'group ID'),
		expectedActiveMemberId: identifier(activeMemberIdValue, 'active member ID'),
	};
}

function group(value: unknown): FramescaperMulticameraGroupSequence {
	const candidate = exactRecord(value, GROUP_FIELDS, 'multicamera group');
	const id = identifier(candidate.id, 'group ID');
	const membersValue = candidate.members;
	if (!Array.isArray(membersValue) || Object.getPrototypeOf(membersValue) !== Array.prototype
		|| membersValue.length < 2 || membersValue.length > 64) {
		throw new RangeError('A Framescaper multicamera group requires between 2 and 64 members.');
	}
	const members = membersValue.map((value, index) => member(value, id, index));
	assertDenseArray(membersValue, 'multicamera members');
	const memberIds = new Set(members.map(({ id }) => id));
	const sourceIds = new Set(members.map(({ sourceId }) => sourceId));
	if (memberIds.size !== members.length || sourceIds.size !== members.length) {
		throw new RangeError('Framescaper multicamera member and source IDs must be unique.');
	}
	const activeMemberId = identifier(candidate.activeMemberId, 'active member ID');
	if (!memberIds.has(activeMemberId)) throw new ReferenceError('The active multicamera member is missing.');
	return Object.freeze({
		id,
		projectId: identifier(candidate.projectId, 'group project ID'),
		sequenceId: identifier(candidate.sequenceId, 'group sequence ID'),
		outputClipId: identifier(candidate.outputClipId, 'group output clip ID'),
		activeMemberId,
		members: Object.freeze(members),
	});
}

function member(value: unknown, groupId: string, index: number): FramescaperMulticameraMemberSequence {
	const candidate = exactRecord(value, MEMBER_FIELDS, `multicamera member ${String(index)}`);
	if (candidate.groupId !== groupId) throw new RangeError('A multicamera member belongs to another group.');
	return Object.freeze({
		id: identifier(candidate.id, 'member ID'),
		groupId,
		sourceId: identifier(candidate.sourceId, 'member source ID'),
		syncOffsetSamples: signedInteger(candidate.syncOffsetSamples, 'member sync offset'),
	});
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const candidate = value as Record<PropertyKey, unknown>;
	const allowed = new Set<PropertyKey>(fields);
	const keys = Reflect.ownKeys(candidate);
	if (keys.length !== fields.length || keys.some((key) => !allowed.has(key))) {
		throw new TypeError(`${name} has an unsupported field.`);
	}
	const result = {} as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function assertDenseArray(value: readonly unknown[], name: string): void {
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || keys.some((key) => (
		key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key))
	))) throw new TypeError(`${name} must be a dense array.`);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain own enumerable data elements.`);
		}
	}
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`Framescaper ${name} must be a non-empty string.`);
	}
	return value;
}

function revision(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('Framescaper project revision must be a non-negative safe integer.');
	}
	return Number(value);
}

function signedInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`Framescaper ${name} must be a safe integer.`);
	return Number(value);
}
