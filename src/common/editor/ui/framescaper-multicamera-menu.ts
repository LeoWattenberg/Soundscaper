/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import { isCurrentProjectSchemaIdentity } from '../project-schema-identity.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface MulticameraMember extends DataRecord {
	readonly id: string;
	readonly groupId: string;
	readonly sourceId: string;
	readonly syncOffsetSamples: number;
}

interface MulticameraGroup extends DataRecord {
	readonly id: string;
	readonly projectId: string;
	readonly sequenceId: string;
	readonly outputClipId: string;
	readonly activeMemberId: string;
	readonly members: readonly MulticameraMember[];
}

export type FramescaperMulticameraMenuCommand =
	| Readonly<{
		readonly type: 'multicamera/create';
		readonly projectId: string;
		readonly expectedProjectRevision: number;
		readonly group: MulticameraGroup;
	}>
	| Readonly<{
		readonly type: 'multicamera/update';
		readonly projectId: string;
		readonly expectedProjectRevision: number;
		readonly groupId: string;
		readonly expectedActiveMemberId: string;
		readonly group: MulticameraGroup;
	}>
	| Readonly<{
		readonly type: 'multicamera/remove';
		readonly projectId: string;
		readonly expectedProjectRevision: number;
		readonly groupId: string;
		readonly expectedActiveMemberId: string;
	}>
	| Readonly<{
		readonly type: 'multicamera/switch';
		readonly projectId: string;
		readonly expectedProjectRevision: number;
		readonly groupId: string;
		readonly expectedActiveMemberId: string;
		readonly memberId: string;
	}>;

export interface FramescaperMulticameraMenuCopy {
	readonly multicamera: string;
	readonly createMulticamera: string;
	readonly switchMulticamera: string;
	readonly nudgeMulticameraEarlier: string;
	readonly nudgeMulticameraLater: string;
	readonly removeMulticamera: string;
}

export interface FramescaperMulticameraMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperMulticameraMenuCopy;
}

export interface FramescaperMulticameraMenuActions {
	execute(command: FramescaperMulticameraMenuCommand): unknown;
}

export interface FramescaperMulticameraMenuLeaf {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface FramescaperMulticameraMenu {
	readonly id: 'multicamera';
	readonly label: string;
	readonly disabled: boolean;
	readonly items: readonly Readonly<FramescaperMulticameraMenuLeaf>[];
}

/** Expose exact manual grouping and sample-sync edits through the existing Tracks menu. */
export function createFramescaperMulticameraMenuItems(
	input: FramescaperMulticameraMenuInput,
	actions: FramescaperMulticameraMenuActions,
): Readonly<FramescaperMulticameraMenu> | null {
	if (input.productId !== 'framescaper') return null;
	const project = record(input.project);
	const enabled = project !== null
		&& isCurrentProjectSchemaIdentity(project, 'framescaper')
		&& !input.editingBlocked;
	const selectedClip = enabled && project ? selectedVideoClip(project) : null;
	const groups = records(project?.multicameraGroups);
	const current = selectedClip
		? groups.find(({ outputClipId }) => outputClipId === selectedClip.id) ?? null
		: null;
	const create = enabled && project && selectedClip && !current
		? createCommand(project, selectedClip, groups) : null;
	const switchCommand = enabled && project && current ? nextMemberCommand(project, current) : null;
	const earlier = enabled && project && current ? nudgeCommand(project, current, -1) : null;
	const later = enabled && project && current ? nudgeCommand(project, current, 1) : null;
	const remove = enabled && project && current ? removeCommand(project, current) : null;
	const items = Object.freeze([
		leaf('multicamera-create', input.copy.createMulticamera, create, actions),
		leaf('multicamera-switch', input.copy.switchMulticamera, switchCommand, actions),
		leaf('multicamera-nudge-earlier', input.copy.nudgeMulticameraEarlier, earlier, actions),
		leaf('multicamera-nudge-later', input.copy.nudgeMulticameraLater, later, actions),
		leaf('multicamera-remove', input.copy.removeMulticamera, remove, actions),
	]);
	return Object.freeze({
		id: 'multicamera', label: input.copy.multicamera,
		disabled: items.every(({ disabled }) => disabled), items,
	});
}

function createCommand(
	project: DataRecord,
	clip: DataRecord,
	groups: readonly DataRecord[],
): FramescaperMulticameraMenuCommand | null {
	const projectId = string(project.id);
	const revision = integer(project.revision, 0);
	const clipId = string(clip.id);
	const sequenceId = string(clip.sequenceId);
	const outputSourceId = string(clip.sourceId);
	if (!projectId || revision === null || !clipId || !sequenceId || !outputSourceId) return null;
	const sources = records(project.sources)
		.filter(({ kind, id }) => kind === 'video' && string(id) !== null)
		.sort((left, right) => compareCodeUnits(String(left.id), String(right.id)));
	const outputIndex = sources.findIndex(({ id }) => id === outputSourceId);
	if (outputIndex < 0 || sources.length < 2) return null;
	const orderedSources = [sources[outputIndex]!, ...sources.filter((_, index) => index !== outputIndex)].slice(0, 64);
	const existingIds = new Set(groups.map(({ id }) => id));
	let suffix = 1;
	let groupId = `multicamera-${clipId}-${String(suffix)}`;
	while (existingIds.has(groupId)) { suffix += 1; groupId = `multicamera-${clipId}-${String(suffix)}`; }
	const members = Object.freeze(orderedSources.map((source, index) => Object.freeze({
		id: `${groupId}-camera-${String(index + 1)}`,
		groupId,
		sourceId: String(source.id),
		syncOffsetSamples: 0,
	})));
	const group = Object.freeze({
		id: groupId, projectId, sequenceId, outputClipId: clipId,
		activeMemberId: members[0]!.id, members,
	});
	return Object.freeze({
		type: 'multicamera/create', projectId, expectedProjectRevision: revision, group,
	});
}

function nextMemberCommand(project: DataRecord, group: DataRecord): FramescaperMulticameraMenuCommand | null {
	const fence = existingFence(project, group);
	const members = records(group.members);
	const currentIndex = members.findIndex(({ id }) => id === fence?.expectedActiveMemberId);
	if (!fence || members.length < 2 || currentIndex < 0) return null;
	const memberId = string(members[(currentIndex + 1) % members.length]?.id);
	return memberId ? Object.freeze({ type: 'multicamera/switch', ...fence, memberId }) : null;
}

function nudgeCommand(
	project: DataRecord,
	group: DataRecord,
	direction: -1 | 1,
): FramescaperMulticameraMenuCommand | null {
	const fence = existingFence(project, group);
	const members = records(group.members);
	const activeIndex = members.findIndex(({ id }) => id === fence?.expectedActiveMemberId);
	const activeOffset = integer(members[activeIndex]?.syncOffsetSamples, Number.MIN_SAFE_INTEGER);
	const step = activeSourceFrameSamples(project, members[activeIndex]);
	if (!fence || activeIndex < 0 || activeOffset === null || step === null) return null;
	const syncOffsetSamples = activeOffset + direction * step;
	if (!Number.isSafeInteger(syncOffsetSamples)) return null;
	const snapshotMembers = members.map((member, index) => Object.freeze({
		...member,
		...(index === activeIndex ? { syncOffsetSamples } : {}),
	}));
	const replacement = Object.freeze({ ...group, members: Object.freeze(snapshotMembers) });
	return Object.freeze({ type: 'multicamera/update', ...fence, group: replacement as MulticameraGroup });
}

/**
 * A sync offset lands on the member source's own frame grid and is stored in samples, so
 * one conformed source frame is the smallest legal step and a grid no whole sample count
 * spans, such as 30000/1001 frames at 48 kHz, has no representable step at all.
 */
function activeSourceFrameSamples(project: DataRecord, member: DataRecord | undefined): number | null {
	const sampleRate = integer(project.sampleRate, 1);
	const source = records(project.sources)
		.find(({ id, kind }) => kind === 'video' && id === member?.sourceId);
	const rate = record(source?.frameRate);
	const num = integer(rate?.num, 1);
	const den = integer(rate?.den, 1);
	if (sampleRate === null || num === null || den === null
		|| record(source?.timingDecision)?.mode !== 'conform-cfr-at-ingest') return null;
	const scaled = sampleRate * den;
	return Number.isSafeInteger(scaled) && scaled % num === 0 ? scaled / num : null;
}

function removeCommand(project: DataRecord, group: DataRecord): FramescaperMulticameraMenuCommand | null {
	const fence = existingFence(project, group);
	return fence ? Object.freeze({ type: 'multicamera/remove', ...fence }) : null;
}

function existingFence(project: DataRecord, group: DataRecord) {
	const projectId = string(project.id);
	const expectedProjectRevision = integer(project.revision, 0);
	const groupId = string(group.id);
	const expectedActiveMemberId = string(group.activeMemberId);
	return projectId && expectedProjectRevision !== null && groupId && expectedActiveMemberId
		? { projectId, expectedProjectRevision, groupId, expectedActiveMemberId }
		: null;
}

function selectedVideoClip(project: DataRecord): DataRecord | null {
	const selection = record(project.selection);
	const selectedId = Array.isArray(selection?.clipIds) ? string(selection.clipIds[0]) : null;
	if (!selectedId) return null;
	return records(project.clips).find(({ id, kind }) => id === selectedId && kind === 'video') ?? null;
}

function leaf(
	id: string,
	label: string,
	command: FramescaperMulticameraMenuCommand | null,
	actions: FramescaperMulticameraMenuActions,
): Readonly<FramescaperMulticameraMenuLeaf> {
	return Object.freeze({
		id, label, disabled: command === null,
		onClick: () => command === null ? undefined : actions.execute(command),
	});
}

function string(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function integer(value: unknown, minimum: number): number | null {
	return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}
