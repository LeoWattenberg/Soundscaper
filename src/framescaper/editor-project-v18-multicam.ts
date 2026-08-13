/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

export const FRAMESCAPER_V18_MAXIMUM_MULTICAMERA_GROUPS = 1_024;
export const FRAMESCAPER_V18_MAXIMUM_MULTICAMERA_MEMBERS = 64;

export interface FramescaperMulticameraMemberV18 {
	readonly id: string;
	readonly groupId: string;
	readonly sourceId: string;
	/** Canonical-source sample offset from the output clip's group-local source position. */
	readonly syncOffsetSamples: number;
}

export interface FramescaperMulticameraGroupV18 {
	readonly id: string;
	readonly projectId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly activeMemberId: string;
	readonly members: readonly FramescaperMulticameraMemberV18[];
}

interface CommandFenceV18 {
	readonly projectId: string;
	readonly expectedProjectRevision: number;
}

interface ExistingGroupFenceV18 extends CommandFenceV18 {
	readonly groupId: string;
	readonly expectedActiveMemberId: string;
}

export type FramescaperMulticameraCommandV18 =
	| Readonly<CommandFenceV18 & {
		readonly type: 'multicamera/create';
		readonly group: FramescaperMulticameraGroupV18;
	}>
	| Readonly<ExistingGroupFenceV18 & {
		readonly type: 'multicamera/update';
		readonly group: FramescaperMulticameraGroupV18;
	}>
	| Readonly<ExistingGroupFenceV18 & { readonly type: 'multicamera/remove' }>
	| Readonly<ExistingGroupFenceV18 & {
		readonly type: 'multicamera/switch';
		readonly memberId: string;
	}>;

export interface FramescaperMulticameraPlanV18 {
	readonly before: readonly FramescaperMulticameraGroupV18[];
	readonly after: readonly FramescaperMulticameraGroupV18[];
}

export interface FramescaperMulticameraRuntimeRequestV18 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly groupId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly activeMemberId: string;
}

export interface FramescaperExactSampleV18 {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export interface FramescaperMulticameraRuntimeSelectionV18 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly groupId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly memberId: string;
	readonly sourceId: string;
	readonly syncOffsetSamples: number;
	readonly timelineStartSample: FramescaperExactSampleV18;
	readonly timelineEndSample: FramescaperExactSampleV18;
	readonly sourceStartSample: FramescaperExactSampleV18;
	readonly sourceEndSample: FramescaperExactSampleV18;
}

interface ExactSample {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

interface ProjectIndex {
	readonly project: FramescaperProjectV18;
	readonly sources: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly clips: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly sequences: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

const GROUP_FIELDS = new Set([
	'id', 'projectId', 'sequenceId', 'outputClipId', 'activeMemberId', 'members',
]);
const MEMBER_FIELDS = new Set(['id', 'groupId', 'sourceId', 'syncOffsetSamples']);

/** Validate and snapshot the dormant exact-V18 multicamera collection. */
export function validateFramescaperMulticameraGroupsV18(
	profile: unknown,
	projectValue: FramescaperProjectV18 | unknown,
	groupsValue: unknown,
): readonly FramescaperMulticameraGroupV18[] {
	validateFramescaperProjectV18(profile, projectValue);
	const index = indexProject(projectValue as FramescaperProjectV18);
	const values = denseArray(groupsValue, 'Framescaper V18 multicamera groups');
	if (values.length > FRAMESCAPER_V18_MAXIMUM_MULTICAMERA_GROUPS) {
		throw new RangeError('Framescaper V18 multicamera groups exceed the maintained limit.');
	}
	const groupIds = new Set<string>();
	const memberIds = new Set<string>();
	const outputClipIds = new Set<string>();
	const groups = values.map((value, groupIndex) => {
		const name = `Framescaper V18 multicamera groups[${String(groupIndex)}]`;
		const candidate = exactDataRecord(value, GROUP_FIELDS, name);
		const id = nonEmptyString(dataProperty(candidate, 'id', name), `${name}.id`);
		if (groupIds.has(id)) throw new RangeError(`Duplicate multicamera group ID: ${id}.`);
		groupIds.add(id);
		const projectId = nonEmptyString(dataProperty(candidate, 'projectId', name), `${name}.projectId`);
		if (projectId !== index.project.id) throw new RangeError(`Multicamera group ${id} belongs to another project.`);
		const outputClipId = nonEmptyString(
			dataProperty(candidate, 'outputClipId', name),
			`${name}.outputClipId`,
		);
		if (outputClipIds.has(outputClipId)) {
			throw new RangeError(`Output clip ${outputClipId} can belong to only one multicamera group.`);
		}
		outputClipIds.add(outputClipId);
		const group: FramescaperMulticameraGroupV18 = {
			id,
			projectId,
			sequenceId: nonEmptyString(dataProperty(candidate, 'sequenceId', name), `${name}.sequenceId`),
			outputClipId,
			activeMemberId: nonEmptyString(
				dataProperty(candidate, 'activeMemberId', name),
				`${name}.activeMemberId`,
			),
			members: normalizeMembers(id, dataProperty(candidate, 'members', name), memberIds, name),
		};
		validateGroupOwnership(index, group);
		return group;
	});
	groups.sort((left, right) => compareStrings(left.id, right.id));
	return freezeGroups(groups);
}

/** Plan a fenced mutation; the caller owns revision increment and history persistence. */
export function planFramescaperMulticameraCommandV18(
	profile: unknown,
	projectValue: FramescaperProjectV18 | unknown,
	groupsValue: unknown,
	commandValue: FramescaperMulticameraCommandV18 | unknown,
): Readonly<FramescaperMulticameraPlanV18> {
	const before = validateFramescaperMulticameraGroupsV18(profile, projectValue, groupsValue);
	const project = projectValue as FramescaperProjectV18;
	const command = commandRecord(commandValue);
	const type = commandType(command);
	const allowed = commandFields(type);
	exactFields(command, allowed, 'Framescaper V18 multicamera command');
	const projectId = nonEmptyString(
		dataProperty(command, 'projectId', 'Framescaper V18 multicamera command'),
		'command.projectId',
	);
	if (projectId !== project.id) throw new RangeError('The multicamera command belongs to another project.');
	const expectedRevision = nonNegativeSafeInteger(
		dataProperty(command, 'expectedProjectRevision', 'Framescaper V18 multicamera command'),
		'command.expectedProjectRevision',
	);
	if (expectedRevision !== project.revision) throw new RangeError('The multicamera command has a stale project revision.');
	let candidate: readonly unknown[];
	if (type === 'multicamera/create') {
		candidate = [...before, dataProperty(command, 'group', 'Framescaper V18 multicamera command')];
	} else {
		const groupId = nonEmptyString(
			dataProperty(command, 'groupId', 'Framescaper V18 multicamera command'),
			'command.groupId',
		);
		const index = before.findIndex((value) => value.id === groupId);
		if (index < 0) throw new ReferenceError(`Multicamera group ${groupId} is missing.`);
		const current = before[index]!;
		const expectedActiveMemberId = nonEmptyString(
			dataProperty(command, 'expectedActiveMemberId', 'Framescaper V18 multicamera command'),
			'command.expectedActiveMemberId',
		);
		if (current.activeMemberId !== expectedActiveMemberId) {
			throw new RangeError(`Multicamera group ${groupId} has a stale active member.`);
		}
		candidate = [...before];
		if (type === 'multicamera/remove') {
			(candidate as unknown[]).splice(index, 1);
		} else if (type === 'multicamera/update') {
			const replacement = dataProperty(command, 'group', 'Framescaper V18 multicamera command');
			const replacementRecord = dataRecord(replacement, 'Multicamera replacement group');
			if (dataProperty(replacementRecord, 'id', 'Multicamera replacement group') !== groupId) {
				throw new RangeError('A multicamera update cannot change the stable group ID.');
			}
			if (dataProperty(replacementRecord, 'activeMemberId', 'Multicamera replacement group')
				!== current.activeMemberId) {
				throw new RangeError('A multicamera update cannot bypass the dedicated member-switch command.');
			}
			(candidate as unknown[])[index] = replacement;
		} else {
			const memberId = nonEmptyString(
				dataProperty(command, 'memberId', 'Framescaper V18 multicamera command'),
				'command.memberId',
			);
			if (!current.members.some((member) => member.id === memberId)) {
				throw new ReferenceError(`Multicamera member ${memberId} is missing.`);
			}
			if (memberId === current.activeMemberId) {
				throw new RangeError(`Multicamera member ${memberId} is already active.`);
			}
			(candidate as unknown[])[index] = { ...current, activeMemberId: memberId };
		}
	}
	const after = validateFramescaperMulticameraGroupsV18(profile, project, candidate);
	return Object.freeze({ before, after });
}

/** Resolve one fully fenced group output to its active canonical source in exact sample time. */
export function selectFramescaperMulticameraRuntimeV18(
	profile: unknown,
	projectValue: FramescaperProjectV18 | unknown,
	groupsValue: unknown,
	requestValue: FramescaperMulticameraRuntimeRequestV18 | unknown,
): Readonly<FramescaperMulticameraRuntimeSelectionV18> {
	const groups = validateFramescaperMulticameraGroupsV18(profile, projectValue, groupsValue);
	const project = projectValue as FramescaperProjectV18;
	const request = runtimeRequest(requestValue);
	if (request.projectId !== project.id) throw new RangeError('The multicamera runtime request has a stale project ID.');
	if (request.projectRevision !== project.revision) {
		throw new RangeError('The multicamera runtime request has a stale project revision.');
	}
	const group = groups.find((value) => value.id === request.groupId);
	if (!group) throw new ReferenceError(`Multicamera group ${request.groupId} is missing.`);
	if (request.sequenceId !== group.sequenceId) throw new RangeError('The multicamera runtime request has a stale sequence.');
	if (request.outputClipId !== group.outputClipId) {
		throw new RangeError('The multicamera runtime request has a stale output clip.');
	}
	if (request.activeMemberId !== group.activeMemberId) {
		throw new RangeError('The multicamera runtime request has a stale active member.');
	}
	const member = group.members.find((value) => value.id === group.activeMemberId)!;
	const index = indexProject(project);
	const ranges = groupSampleRanges(index, group, member);
	return Object.freeze({
		projectId: project.id,
		projectRevision: project.revision,
		groupId: group.id,
		sequenceId: group.sequenceId,
		outputClipId: group.outputClipId,
		memberId: member.id,
		sourceId: member.sourceId,
		syncOffsetSamples: member.syncOffsetSamples,
		timelineStartSample: exactSample(ranges.timelineStart),
		timelineEndSample: exactSample(ranges.timelineEnd),
		sourceStartSample: exactSample(ranges.sourceStart),
		sourceEndSample: exactSample(ranges.sourceEnd),
	});
}

function normalizeMembers(
	groupId: string,
	value: unknown,
	globalIds: Set<string>,
	groupName: string,
): readonly FramescaperMulticameraMemberV18[] {
	const values = denseArray(value, `${groupName}.members`);
	if (values.length < 2 || values.length > FRAMESCAPER_V18_MAXIMUM_MULTICAMERA_MEMBERS) {
		throw new RangeError('A multicamera group requires between 2 and 64 members.');
	}
	const sourceIds = new Set<string>();
	const members = values.map((memberValue, index) => {
		const name = `${groupName}.members[${String(index)}]`;
		const candidate = exactDataRecord(memberValue, MEMBER_FIELDS, name);
		const id = nonEmptyString(dataProperty(candidate, 'id', name), `${name}.id`);
		if (globalIds.has(id)) throw new RangeError(`Duplicate multicamera member ID: ${id}.`);
		globalIds.add(id);
		const owner = nonEmptyString(dataProperty(candidate, 'groupId', name), `${name}.groupId`);
		if (owner !== groupId) throw new RangeError(`Multicamera member ${id} belongs to another group.`);
		const sourceId = nonEmptyString(dataProperty(candidate, 'sourceId', name), `${name}.sourceId`);
		if (sourceIds.has(sourceId)) throw new RangeError(`Duplicate multicamera member source: ${sourceId}.`);
		sourceIds.add(sourceId);
		return {
			id,
			groupId: owner,
			sourceId,
			syncOffsetSamples: signedSafeInteger(
				dataProperty(candidate, 'syncOffsetSamples', name),
				`${name}.syncOffsetSamples`,
			),
		};
	});
	members.sort((left, right) => compareStrings(left.id, right.id));
	return members;
}

function validateGroupOwnership(index: ProjectIndex, group: FramescaperMulticameraGroupV18): void {
	const sequence = index.sequences.get(group.sequenceId);
	if (!sequence) throw new ReferenceError(`Multicamera group ${group.id} references a missing sequence.`);
	const clip = index.clips.get(group.outputClipId);
	if (!clip || clip.kind !== 'video') {
		throw new ReferenceError(`Multicamera group ${group.id} references a missing video output clip.`);
	}
	if (clip.sequenceId !== group.sequenceId) {
		throw new RangeError(`Multicamera group ${group.id} output clip belongs to another sequence.`);
	}
	if (clip.retimeMap !== null) throw new RangeError('A multicamera output clip cannot carry a retime map.');
	if (clip.sequenceFrameCount !== clip.sourceFrameCount) {
		throw new RangeError('A multicamera output clip must preserve exact one-to-one group time.');
	}
	const owners = (index.project.tracks as readonly Readonly<Record<string, unknown>>[]).filter((track) =>
		(track.clipIds as readonly string[]).includes(group.outputClipId));
	if (owners.length !== 1 || owners[0]?.type !== 'video') {
		throw new RangeError(`Multicamera output clip ${group.outputClipId} requires exactly one video track owner.`);
	}
	const ownerId = String(owners[0].id);
	if (!(sequence.trackIds as readonly string[]).includes(ownerId)) {
		throw new RangeError(`Multicamera output clip ${group.outputClipId} has invalid sequence ownership.`);
	}
	const sequenceOwners = [...index.sequences.values()].filter((value) =>
		(value.trackIds as readonly string[]).includes(ownerId));
	if (sequenceOwners.length !== 1 || sequenceOwners[0]?.id !== group.sequenceId) {
		throw new RangeError(`Multicamera output clip ${group.outputClipId} requires exact sequence ownership.`);
	}
	const active = group.members.find((value) => value.id === group.activeMemberId);
	if (!active) throw new ReferenceError(`Multicamera group ${group.id} has a missing active member.`);
	for (const member of group.members) {
		const source = index.sources.get(member.sourceId);
		if (!source || source.kind !== 'video') {
			throw new ReferenceError(`Multicamera member ${member.id} references a missing canonical video source.`);
		}
		groupSampleRanges(index, group, member);
	}
	if (!group.members.some((value) => value.sourceId === clip.sourceId)) {
		throw new RangeError(`Multicamera output clip ${group.outputClipId} must reference one group member source.`);
	}
}

function groupSampleRanges(
	index: ProjectIndex,
	group: FramescaperMulticameraGroupV18,
	member: FramescaperMulticameraMemberV18,
): Readonly<{
	readonly timelineStart: ExactSample;
	readonly timelineEnd: ExactSample;
	readonly sourceStart: ExactSample;
	readonly sourceEnd: ExactSample;
}> {
	const clip = index.clips.get(group.outputClipId)!;
	const sequence = index.sequences.get(group.sequenceId)!;
	const rate = sequence.rate as Readonly<{ readonly num: number; readonly den: number }>;
	const timelineStart = frameToSample(Number(clip.sequenceStartFrame), index.project.sampleRate, rate);
	const timelineEnd = frameToSample(
		safeSum(Number(clip.sequenceStartFrame), Number(clip.sequenceFrameCount), 'multicamera output range'),
		index.project.sampleRate,
		rate,
	);
	const groupSourceStart = frameToSample(Number(clip.sourceInFrame), index.project.sampleRate, rate);
	const groupSourceEnd = frameToSample(
		safeSum(Number(clip.sourceInFrame), Number(clip.sourceFrameCount), 'multicamera group-source range'),
		index.project.sampleRate,
		rate,
	);
	const offset = integer(member.syncOffsetSamples);
	const sourceStart = add(groupSourceStart, offset);
	const sourceEnd = add(groupSourceEnd, offset);
	const source = index.sources.get(member.sourceId)!;
	const sourceLimit = integer(Number(source.sampleFrameCount));
	if (compare(sourceStart, integer(0)) < 0 || compare(sourceEnd, sourceLimit) > 0) {
		throw new RangeError(`Multicamera member ${member.id} lies outside canonical source bounds.`);
	}
	return { timelineStart, timelineEnd, sourceStart, sourceEnd };
}

function indexProject(project: FramescaperProjectV18): ProjectIndex {
	return {
		project,
		sources: new Map(project.sources.map((value) => [String(value.id), value])),
		clips: new Map(project.clips.map((value) => [String(value.id), value])),
		sequences: new Map(project.sequences.map((value) => [String(value.id), value])),
	};
}

function runtimeRequest(value: unknown): FramescaperMulticameraRuntimeRequestV18 {
	const name = 'Framescaper V18 multicamera runtime request';
	const candidate = exactDataRecord(value, new Set([
		'projectId', 'projectRevision', 'groupId', 'sequenceId', 'outputClipId', 'activeMemberId',
	]), name);
	return {
		projectId: nonEmptyString(dataProperty(candidate, 'projectId', name), `${name}.projectId`),
		projectRevision: nonNegativeSafeInteger(
			dataProperty(candidate, 'projectRevision', name),
			`${name}.projectRevision`,
		),
		groupId: nonEmptyString(dataProperty(candidate, 'groupId', name), `${name}.groupId`),
		sequenceId: nonEmptyString(dataProperty(candidate, 'sequenceId', name), `${name}.sequenceId`),
		outputClipId: nonEmptyString(dataProperty(candidate, 'outputClipId', name), `${name}.outputClipId`),
		activeMemberId: nonEmptyString(
			dataProperty(candidate, 'activeMemberId', name),
			`${name}.activeMemberId`,
		),
	};
}

function commandRecord(value: unknown): Record<string, unknown> {
	return dataRecord(value, 'Framescaper V18 multicamera command');
}

function commandType(value: Record<string, unknown>): FramescaperMulticameraCommandV18['type'] {
	const type = dataProperty(value, 'type', 'Framescaper V18 multicamera command');
	if (type !== 'multicamera/create' && type !== 'multicamera/update'
		&& type !== 'multicamera/remove' && type !== 'multicamera/switch') {
		throw new TypeError('Unsupported Framescaper V18 multicamera command type.');
	}
	return type;
}

function commandFields(type: FramescaperMulticameraCommandV18['type']): ReadonlySet<string> {
	const fields = ['type', 'projectId', 'expectedProjectRevision'];
	if (type === 'multicamera/create' || type === 'multicamera/update') fields.push('group');
	if (type !== 'multicamera/create') fields.push('groupId', 'expectedActiveMemberId');
	if (type === 'multicamera/switch') fields.push('memberId');
	return new Set(fields);
}

function exactDataRecord(value: unknown, fields: ReadonlySet<string>, name: string): Record<string, unknown> {
	const record = dataRecord(value, name);
	exactFields(record, fields, name);
	return record;
}

function exactFields(value: Record<string, unknown>, fields: ReadonlySet<string>, name: string): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !fields.has(key)) throw new TypeError(`${name} has an unsupported field.`);
	}
	for (const field of fields) dataProperty(value, field, name);
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

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function signedSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a signed safe integer.`);
	return Number(value);
}

function safeSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe-integer range.`);
	return result;
}

function frameToSample(
	frame: number,
	sampleRate: number,
	rate: Readonly<{ readonly num: number; readonly den: number }>,
): ExactSample {
	return fraction(BigInt(frame) * BigInt(sampleRate) * BigInt(rate.den), BigInt(rate.num));
}

function integer(value: number): ExactSample {
	return fraction(BigInt(value), 1n);
}

function add(left: ExactSample, right: ExactSample): ExactSample {
	return fraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function compare(left: ExactSample, right: ExactSample): number {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function fraction(numerator: bigint, denominator: bigint): ExactSample {
	if (denominator === 0n) throw new RangeError('An exact multicamera sample denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left === 0n ? 1n : left;
}

function exactSample(value: ExactSample): Readonly<FramescaperExactSampleV18> {
	return Object.freeze({ numerator: value.numerator, denominator: value.denominator });
}

function freezeGroups(values: readonly FramescaperMulticameraGroupV18[]): readonly FramescaperMulticameraGroupV18[] {
	return Object.freeze(values.map((group) => Object.freeze({
		...group,
		members: Object.freeze(group.members.map((member) => Object.freeze({ ...member }))),
	})));
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
