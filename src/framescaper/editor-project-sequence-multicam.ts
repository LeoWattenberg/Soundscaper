/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	sourceTimeToVideoBoundary,
	videoBoundaryTime,
	videoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectSequence } from './editor-project-sequence-validation.ts';

export const FRAMESCAPER_SEQUENCE_MAXIMUM_MULTICAMERA_GROUPS = 1_024;
export const FRAMESCAPER_SEQUENCE_MAXIMUM_MULTICAMERA_MEMBERS = 64;

export interface FramescaperMulticameraMemberSequence {
	readonly id: string;
	readonly groupId: string;
	readonly sourceId: string;
	/** Canonical-source sample offset from the output clip's group-local source position. */
	readonly syncOffsetSamples: number;
}

export interface FramescaperMulticameraGroupSequence {
	readonly id: string;
	readonly projectId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly activeMemberId: string;
	readonly members: readonly FramescaperMulticameraMemberSequence[];
}

interface CommandFenceSequence {
	readonly projectId: string;
	readonly expectedProjectRevision: number;
}

interface ExistingGroupFenceSequence extends CommandFenceSequence {
	readonly groupId: string;
	readonly expectedActiveMemberId: string;
}

export type FramescaperMulticameraCommandSequence =
	| Readonly<CommandFenceSequence & {
		readonly type: 'multicamera/create';
		readonly group: FramescaperMulticameraGroupSequence;
	}>
	| Readonly<ExistingGroupFenceSequence & {
		readonly type: 'multicamera/update';
		readonly group: FramescaperMulticameraGroupSequence;
	}>
	| Readonly<ExistingGroupFenceSequence & { readonly type: 'multicamera/remove' }>
	| Readonly<ExistingGroupFenceSequence & {
		readonly type: 'multicamera/switch';
		readonly memberId: string;
	}>;

export interface FramescaperMulticameraPlanSequence {
	readonly before: readonly FramescaperMulticameraGroupSequence[];
	readonly after: readonly FramescaperMulticameraGroupSequence[];
}

export interface FramescaperMulticameraRuntimeRequestSequence {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly groupId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly activeMemberId: string;
}

export interface FramescaperExactSampleSequence {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export interface FramescaperMulticameraRuntimeSelectionSequence {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly groupId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly memberId: string;
	readonly sourceId: string;
	readonly syncOffsetSamples: number;
	readonly timelineStartSample: FramescaperExactSampleSequence;
	readonly timelineEndSample: FramescaperExactSampleSequence;
	readonly sourceStartSample: FramescaperExactSampleSequence;
	readonly sourceEndSample: FramescaperExactSampleSequence;
}

interface ExactSample {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

interface ProjectIndex {
	readonly project: FramescaperProjectSequence;
	readonly sources: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly clips: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly sequences: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	/** Verified frame grids, resolved once per validation and only where a group needs one. */
	readonly timingViews: () => ReadonlyMap<string, VideoSourceTimingView>;
}

const GROUP_FIELDS = new Set([
	'id', 'projectId', 'sequenceId', 'outputClipId', 'activeMemberId', 'members',
]);
const MEMBER_FIELDS = new Set(['id', 'groupId', 'sourceId', 'syncOffsetSamples']);

/** Validate and snapshot the dormant exact-sequence multicamera collection. */
export function validateFramescaperMulticameraGroupsSequence(
	profile: unknown,
	projectValue: FramescaperProjectSequence | unknown,
	groupsValue: unknown,
): readonly FramescaperMulticameraGroupSequence[] {
	assertFramescaperProjectSequenceProfile(profile);
	const index = indexProject(projectEnvelope(projectValue));
	const values = denseArray(groupsValue, 'Framescaper sequence multicamera groups');
	if (values.length > FRAMESCAPER_SEQUENCE_MAXIMUM_MULTICAMERA_GROUPS) {
		throw new RangeError('Framescaper sequence multicamera groups exceed the maintained limit.');
	}
	const groupIds = new Set<string>();
	const memberIds = new Set<string>();
	const outputClipIds = new Set<string>();
	const groups = values.map((value, groupIndex) => {
		const name = `Framescaper sequence multicamera groups[${String(groupIndex)}]`;
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
		const group: FramescaperMulticameraGroupSequence = {
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

export function isFramescaperMulticameraCommandSequence(
	value: unknown,
): value is FramescaperMulticameraCommandSequence {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& (descriptor.value === 'multicamera/create'
			|| descriptor.value === 'multicamera/update'
			|| descriptor.value === 'multicamera/remove'
			|| descriptor.value === 'multicamera/switch'),
	);
}

/** Plan a fenced mutation; the caller owns revision increment and history persistence. */
export function planFramescaperMulticameraCommandSequence(
	profile: unknown,
	projectValue: FramescaperProjectSequence | unknown,
	groupsValue: unknown,
	commandValue: FramescaperMulticameraCommandSequence | unknown,
): Readonly<FramescaperMulticameraPlanSequence> {
	const before = validateFramescaperMulticameraGroupsSequence(profile, projectValue, groupsValue);
	const project = projectValue as FramescaperProjectSequence;
	const command = commandRecord(commandValue);
	const type = commandType(command);
	const allowed = commandFields(type);
	exactFields(command, allowed, 'Framescaper sequence multicamera command');
	const projectId = nonEmptyString(
		dataProperty(command, 'projectId', 'Framescaper sequence multicamera command'),
		'command.projectId',
	);
	if (projectId !== project.id) throw new RangeError('The multicamera command belongs to another project.');
	const expectedRevision = nonNegativeSafeInteger(
		dataProperty(command, 'expectedProjectRevision', 'Framescaper sequence multicamera command'),
		'command.expectedProjectRevision',
	);
	if (expectedRevision !== project.revision) throw new RangeError('The multicamera command has a stale project revision.');
	let candidate: readonly unknown[];
	if (type === 'multicamera/create') {
		candidate = [...before, dataProperty(command, 'group', 'Framescaper sequence multicamera command')];
	} else {
		const groupId = nonEmptyString(
			dataProperty(command, 'groupId', 'Framescaper sequence multicamera command'),
			'command.groupId',
		);
		const index = before.findIndex((value) => value.id === groupId);
		if (index < 0) throw new ReferenceError(`Multicamera group ${groupId} is missing.`);
		const current = before[index]!;
		const expectedActiveMemberId = nonEmptyString(
			dataProperty(command, 'expectedActiveMemberId', 'Framescaper sequence multicamera command'),
			'command.expectedActiveMemberId',
		);
		if (current.activeMemberId !== expectedActiveMemberId) {
			throw new RangeError(`Multicamera group ${groupId} has a stale active member.`);
		}
		candidate = [...before];
		if (type === 'multicamera/remove') {
			(candidate as unknown[]).splice(index, 1);
		} else if (type === 'multicamera/update') {
			const replacement = dataProperty(command, 'group', 'Framescaper sequence multicamera command');
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
				dataProperty(command, 'memberId', 'Framescaper sequence multicamera command'),
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
	const after = validateFramescaperMulticameraGroupsSequence(profile, project, candidate);
	return Object.freeze({ before, after });
}

/** Resolve one fully fenced group output to its active canonical source in exact sample time. */
export function selectFramescaperMulticameraRuntimeSequence(
	profile: unknown,
	projectValue: FramescaperProjectSequence | unknown,
	groupsValue: unknown,
	requestValue: FramescaperMulticameraRuntimeRequestSequence | unknown,
): Readonly<FramescaperMulticameraRuntimeSelectionSequence> {
	const groups = validateFramescaperMulticameraGroupsSequence(profile, projectValue, groupsValue);
	const project = projectValue as FramescaperProjectSequence;
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
): readonly FramescaperMulticameraMemberSequence[] {
	const values = denseArray(value, `${groupName}.members`);
	if (values.length < 2 || values.length > FRAMESCAPER_SEQUENCE_MAXIMUM_MULTICAMERA_MEMBERS) {
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

function validateGroupOwnership(index: ProjectIndex, group: FramescaperMulticameraGroupSequence): void {
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
	group: FramescaperMulticameraGroupSequence,
	member: FramescaperMulticameraMemberSequence,
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
	assertSourceBoundaries(index, member, sourceStart, sourceEnd);
	return { timelineStart, timelineEnd, sourceStart, sourceEnd };
}

/**
 * The runtime projection replaces the output source only at an exact member boundary, so a
 * member time between two source frames can never be persisted. Exact timing that is not yet
 * verified is absent from the view map; those members refuse at the projection, not at rest.
 */
function assertSourceBoundaries(
	index: ProjectIndex,
	member: FramescaperMulticameraMemberSequence,
	sourceStart: ExactSample,
	sourceEnd: ExactSample,
): void {
	const timingViews = index.timingViews();
	if (!timingViews.has(member.sourceId)) return;
	const view = videoSourceTimingView(timingViews, index.sources.get(member.sourceId)!);
	const sampleRate = BigInt(Number(index.project.sampleRate));
	for (const [edge, sample] of [['start', sourceStart], ['end', sourceEnd]] as const) {
		const time = { numerator: sample.numerator, denominator: sample.denominator * sampleRate };
		if (compare(videoBoundaryTime(view, sourceTimeToVideoBoundary(view, time)), time) !== 0) {
			throw new RangeError(`Multicamera member ${member.id} ${edge} is not an exact canonical-source boundary.`);
		}
	}
}

function indexProject(project: FramescaperProjectSequence): ProjectIndex {
	let timingViews: ReadonlyMap<string, VideoSourceTimingView> | null = null;
	return {
		project,
		sources: new Map(project.sources.map((value) => [String(value.id), value])),
		clips: new Map(project.clips.map((value) => [String(value.id), value])),
		sequences: new Map(project.sequences.map((value) => [String(value.id), value])),
		timingViews: () => timingViews ??= resolveVideoSourceTimingViews(project),
	};
}

function projectEnvelope(value: unknown): FramescaperProjectSequence {
	const project = dataRecord(value, 'Framescaper sequence multicamera project');
	if (dataProperty(project, 'schemaFamily', 'Framescaper multicamera project') !== 'framescaper'
		|| dataProperty(project, 'schemaVersion', 'Framescaper multicamera project') !== 1) {
		throw new RangeError('Multicamera groups require an exact Framescaper 1.0 project.');
	}
	for (const field of ['id', 'revision', 'sampleRate', 'sources', 'clips', 'tracks', 'sequences']) {
		dataProperty(project, field, 'Framescaper sequence multicamera project');
	}
	return project as FramescaperProjectSequence;
}

function runtimeRequest(value: unknown): FramescaperMulticameraRuntimeRequestSequence {
	const name = 'Framescaper sequence multicamera runtime request';
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
	return dataRecord(value, 'Framescaper sequence multicamera command');
}

function commandType(value: Record<string, unknown>): FramescaperMulticameraCommandSequence['type'] {
	const type = dataProperty(value, 'type', 'Framescaper sequence multicamera command');
	if (type !== 'multicamera/create' && type !== 'multicamera/update'
		&& type !== 'multicamera/remove' && type !== 'multicamera/switch') {
		throw new TypeError('Unsupported Framescaper sequence multicamera command type.');
	}
	return type;
}

function commandFields(type: FramescaperMulticameraCommandSequence['type']): ReadonlySet<string> {
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

function exactSample(value: ExactSample): Readonly<FramescaperExactSampleSequence> {
	return Object.freeze({ numerator: value.numerator, denominator: value.denominator });
}

function freezeGroups(values: readonly FramescaperMulticameraGroupSequence[]): readonly FramescaperMulticameraGroupSequence[] {
	return Object.freeze(values.map((group) => Object.freeze({
		...group,
		members: Object.freeze(group.members.map((member) => Object.freeze({ ...member }))),
	})));
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
