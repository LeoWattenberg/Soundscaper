/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from '../take-comp-document-v17.ts';
import {
	normalizeTakeCompGroupId,
	planTakeCompFlatten,
	type TakeCompGroup,
} from '../take-comp-domain.ts';
import { isTakeCompProjectSchema } from '../project-schema-version.ts';
import {
	defineTakeCompCommandHandlers,
	type TakeCompCommandHandlers,
} from './take-comp.ts';
import type {
	AudioEditorCommand,
	CommandObject,
	EditorCommandProject,
} from './protocol.ts';

type ChildCommandDispatcher = (project: EditorCommandProject, command: AudioEditorCommand) => void;
type DataRecord = Record<string, unknown>;

interface MutableTakeCompProject extends DataRecord {
	schemaVersion: number;
	takeGroups: unknown;
}

export function createTakeCompRuntimeHandlers(
	dispatchChild: ChildCommandDispatcher,
): Readonly<TakeCompCommandHandlers> {
	return defineTakeCompCommandHandlers({
		'take-comp/group-add': (project, command) => addGroup(takeProject(project), command.group),
		'take-comp/group-update': (project, command) => updateGroup(
			takeProject(project), command.groupId, command.group,
		),
		'take-comp/group-remove': (project, command) => removeGroup(
			takeProject(project), command.groupId,
		),
		'take-comp/flatten': (project, command) => flattenGroup(
			takeProject(project), command, dispatchChild,
		),
	});
}

function takeProject(project: EditorCommandProject): MutableTakeCompProject {
	const candidate = project as MutableTakeCompProject;
	if (!isTakeCompProjectSchema(candidate.schemaVersion)) {
		throw new RangeError('Take comp commands require a schema-V17 project.');
	}
	if (!Array.isArray(candidate.takeGroups)) {
		throw new TypeError('project.takeGroups must be an array.');
	}
	return candidate;
}

function groups(project: MutableTakeCompProject): readonly TakeCompDocumentGroup[] {
	return createTakeCompDocumentGroupsV17(project.takeGroups, project);
}

function replaceGroups(project: MutableTakeCompProject, values: readonly unknown[]): void {
	project.takeGroups = createTakeCompDocumentGroupsV17(values, project);
}

function addGroup(project: MutableTakeCompProject, group: CommandObject): void {
	replaceGroups(project, [...groups(project), group]);
}

function updateGroup(project: MutableTakeCompProject, groupIdValue: string, group: CommandObject): void {
	const groupId = normalizeTakeCompGroupId(groupIdValue);
	const current = groups(project);
	const index = current.findIndex((candidate) => candidate.id === groupId);
	if (index < 0) throw new ReferenceError(`Unknown take group: ${groupId}.`);
	if (ownData(group, 'id', 'take group') !== groupId) {
		throw new RangeError('Take group identity is immutable.');
	}
	replaceGroups(project, current.map((candidate, candidateIndex) => (
		candidateIndex === index ? group : candidate
	)));
}

function removeGroup(project: MutableTakeCompProject, groupIdValue: string): void {
	const groupId = normalizeTakeCompGroupId(groupIdValue);
	const current = groups(project);
	if (!current.some((candidate) => candidate.id === groupId)) {
		throw new ReferenceError(`Unknown take group: ${groupId}.`);
	}
	replaceGroups(project, current.filter((candidate) => candidate.id !== groupId));
}

function flattenGroup(
	project: MutableTakeCompProject,
	command: Extract<AudioEditorCommand, { readonly type: 'take-comp/flatten' }>,
	dispatchChild: ChildCommandDispatcher,
): void {
	const groupId = normalizeTakeCompGroupId(command.groupId);
	const current = groups(project);
	const index = current.findIndex((candidate) => candidate.id === groupId);
	if (index < 0) throw new ReferenceError(`Unknown take group: ${groupId}.`);
	const group = current[index]!;
	const snapshotGroups = current.map((candidate, candidateIndex) => (
		candidateIndex === index ? command.preFlattenSnapshot : candidate
	));
	const normalizedSnapshot = createTakeCompDocumentGroupsV17(snapshotGroups, project)[index];
	if (!normalizedSnapshot || !sameData(normalizedSnapshot, group)) {
		throw new RangeError(`Take group ${groupId} changed after flatten rendering began.`);
	}
	const plan = planTakeCompFlatten(coreGroup(group), {
		operationId: command.operationId,
		outputId: command.outputId,
	});
	assertPublication(project, group, plan.outputId, command.source, command.clip);
	dispatchChild(project, { type: 'source/add', source: command.source });
	dispatchChild(project, { type: 'clip/add', trackId: group.trackId, clip: command.clip });
	replaceGroups(project, current.filter((candidate) => candidate.id !== groupId));
}

function coreGroup(group: TakeCompDocumentGroup): TakeCompGroup {
	return {
		id: group.id,
		startSample: group.startSample,
		endSample: group.endSample,
		laneOrder: group.laneOrder,
		lanes: group.lanes,
		takes: group.takes.map(({ id, laneId }) => ({ id, laneId })),
		compRegions: group.compRegions,
	};
}

function assertPublication(
	project: MutableTakeCompProject,
	group: TakeCompDocumentGroup,
	outputId: string,
	source: CommandObject,
	clip: CommandObject,
): void {
	const duration = group.endSample - group.startSample;
	if (ownData(source, 'kind', 'flatten source') !== 'audio'
		|| ownData(source, 'frameCount', 'flatten source') !== duration
		|| ownData(source, 'sampleRate', 'flatten source') !== project.sampleRate) {
		throw new RangeError('Flatten source must be exact project-rate audio for the take group extent.');
	}
	const sourceId = ownData(source, 'id', 'flatten source');
	if (typeof sourceId !== 'string' || !sourceId.length) {
		throw new TypeError('Flatten source requires a stable ID.');
	}
	const exactClip = ownData(clip, 'kind', 'flatten clip') === 'audio'
		&& ownData(clip, 'anchor', 'flatten clip') === 'sample'
		&& ownData(clip, 'id', 'flatten clip') === outputId
		&& ownData(clip, 'sourceId', 'flatten clip') === sourceId
		&& ownData(clip, 'timelineStartFrame', 'flatten clip') === group.startSample
		&& ownData(clip, 'durationFrames', 'flatten clip') === duration
		&& ownData(clip, 'sourceStartFrame', 'flatten clip') === 0
		&& ownData(clip, 'sourceDurationFrames', 'flatten clip') === duration;
	if (!exactClip) {
		throw new RangeError('Flatten clip must publish the exact take group extent without implicit fitting.');
	}
}

function ownData(value: CommandObject, key: string, name: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function sameData(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length
			&& left.every((value, index) => sameData(value, right[index]));
	}
	const leftRecord = left as Readonly<Record<string, unknown>>;
	const rightRecord = right as Readonly<Record<string, unknown>>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return leftKeys.length === rightKeys.length && leftKeys.every((key) => (
		Object.hasOwn(rightRecord, key) && sameData(leftRecord[key], rightRecord[key])
	));
}
