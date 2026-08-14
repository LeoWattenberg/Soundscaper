/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import {
	createTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from '../take-comp-document-v17.ts';
import {
	normalizeTakeCompGroupId,
	normalizeTakeLaneId,
	planCompRegionBoundaryEdit,
	planSharedCompBoundaryEdit,
	planTakeAudition,
	planTakeCompFlatten,
	planTakePromotion,
	type CompRegionBoundaryEditRequest,
	type SharedCompBoundaryEditRequest,
	type TakeAuditionPlan,
	type TakeCompFlattenPlan,
	type TakeCompGroup,
	type TakePromotionRequest,
} from '../take-comp-domain.ts';
import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../project-v17-validation.ts';
import { isTakeCompProjectSchema } from '../project-schema-version.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

export interface TakeLaneAuditionPlan {
	readonly kind: 'audition-lane';
	readonly groupId: string;
	readonly laneId: string;
	readonly takes: readonly TakeAuditionPlan[];
}

export interface PreparedTakeCompFlatten {
	readonly renderPlan: TakeCompFlattenPlan;
	readonly documentSnapshot: TakeCompDocumentGroup;
}

export interface TakeCompFlattenPublication {
	readonly source: CommandObject;
	readonly clip: CommandObject;
}

export interface TakeCompServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	getProject(): AudioEditorProjectV17;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
}

export interface TakeCompService {
	createGroup(group: unknown): unknown;
	updateGroup(groupId: string, group: unknown): unknown;
	removeGroup(groupId: string): unknown;
	auditionTake(groupId: string, takeId: string): TakeAuditionPlan;
	auditionLane(groupId: string, laneId: string): TakeLaneAuditionPlan;
	promoteTake(groupId: string, request: TakePromotionRequest): unknown;
	editCompBoundary(groupId: string, request: CompRegionBoundaryEditRequest): unknown;
	editSharedCompBoundary(groupId: string, request: SharedCompBoundaryEditRequest): unknown;
	prepareFlatten(groupId: string, operationId: string, outputId: string): PreparedTakeCompFlatten;
	publishFlatten(preparation: PreparedTakeCompFlatten, publication: TakeCompFlattenPublication): unknown;
}

/** Write-gated controller boundary over the serializable V17 take/comp command set. */
export function createTakeCompService(
	dependencies: TakeCompServiceDependencies,
): Readonly<TakeCompService> {
	return Object.freeze({
		createGroup,
		updateGroup,
		removeGroup,
		auditionTake,
		auditionLane,
		promoteTake,
		editCompBoundary,
		editSharedCompBoundary,
		prepareFlatten,
		publishFlatten,
	});

	function createGroup(groupValue: unknown): unknown {
		const project = writableProject();
		const current = canonicalGroups(project);
		const existingIds = new Set(current.map(({ id }) => id));
		const next = createTakeCompDocumentGroupsV17([...current, groupValue], project);
		const group = next.find(({ id }) => !existingIds.has(id));
		if (!group) throw new RangeError('Take group creation requires one fresh stable identity.');
		assertTrackWritable(project, group.trackId);
		return dependencies.commit({ type: 'take-comp/group-add', group: commandObject(group) });
	}

	function updateGroup(groupIdValue: string, groupValue: unknown): unknown {
		const project = writableProject();
		const groupId = normalizeTakeCompGroupId(groupIdValue);
		const current = canonicalGroups(project);
		const index = groupIndex(current, groupId);
		const next = createTakeCompDocumentGroupsV17(current.map((group, candidateIndex) => (
			candidateIndex === index ? groupValue : group
		)), project);
		const group = next.find((candidate) => candidate.id === groupId);
		if (!group) throw new RangeError('Take group identity is immutable.');
		assertTrackWritable(project, current[index]!.trackId);
		assertTrackWritable(project, group.trackId);
		return dependencies.commit({
			type: 'take-comp/group-update', groupId, group: commandObject(group),
		});
	}

	function removeGroup(groupIdValue: string): unknown {
		const project = writableProject();
		const group = requireGroup(project, groupIdValue);
		assertTrackWritable(project, group.trackId);
		return dependencies.commit({ type: 'take-comp/group-remove', groupId: group.id });
	}

	function auditionTake(groupId: string, takeId: string): TakeAuditionPlan {
		const group = readableGroup(groupId);
		return planTakeAudition(coreGroup(group), takeId);
	}

	function auditionLane(groupId: string, laneIdValue: string): TakeLaneAuditionPlan {
		const group = readableGroup(groupId);
		const laneId = normalizeTakeLaneId(laneIdValue);
		if (!group.lanes.some(({ id }) => id === laneId)) {
			throw new ReferenceError(`Take lane ${laneId} does not belong to take group ${group.id}.`);
		}
		const takes = group.takes
			.filter((take) => take.laneId === laneId)
			.map((take) => planTakeAudition(coreGroup(group), take.id));
		return Object.freeze({
			kind: 'audition-lane', groupId: group.id, laneId,
			takes: Object.freeze(takes),
		});
	}

	function promoteTake(groupId: string, request: TakePromotionRequest): unknown {
		return updateFromPlan(groupId, (group) => planTakePromotion(coreGroup(group), request).nextGroup);
	}

	function editCompBoundary(groupId: string, request: CompRegionBoundaryEditRequest): unknown {
		return updateFromPlan(groupId, (group) => planCompRegionBoundaryEdit(coreGroup(group), request).nextGroup);
	}

	function editSharedCompBoundary(groupId: string, request: SharedCompBoundaryEditRequest): unknown {
		return updateFromPlan(groupId, (group) => planSharedCompBoundaryEdit(coreGroup(group), request).nextGroup);
	}

	function prepareFlatten(groupId: string, operationId: string, outputId: string): PreparedTakeCompFlatten {
		const group = readableGroup(groupId);
		const renderPlan = planTakeCompFlatten(coreGroup(group), { operationId, outputId });
		return Object.freeze({ renderPlan, documentSnapshot: group });
	}

	function publishFlatten(
		preparation: PreparedTakeCompFlatten,
		publication: TakeCompFlattenPublication,
	): unknown {
		const project = writableProject();
		const group = requireGroup(project, preparation.renderPlan.groupId);
		assertTrackWritable(project, group.trackId);
		return dependencies.commit({
			type: 'take-comp/flatten',
			groupId: preparation.renderPlan.groupId,
			operationId: preparation.renderPlan.operationId,
			outputId: preparation.renderPlan.outputId,
			preFlattenSnapshot: commandObject(preparation.documentSnapshot),
			source: publication.source,
			clip: publication.clip,
		});
	}

	function updateFromPlan(
		groupId: string,
		plan: (group: TakeCompDocumentGroup) => TakeCompGroup,
	): unknown {
		const project = writableProject();
		const group = requireGroup(project, groupId);
		assertTrackWritable(project, group.trackId);
		const next = documentGroupWithCore(group, plan(group));
		return dependencies.commit({
			type: 'take-comp/group-update', groupId: group.id, group: commandObject(next),
		});
	}

	function readableGroup(groupId: string): TakeCompDocumentGroup {
		dependencies.lifetime.assertActive();
		return requireGroup(validProject(), groupId);
	}

	function writableProject(): AudioEditorProjectV17 {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		return validProject();
	}

	function validProject(): AudioEditorProjectV17 {
		const project = dependencies.getProject();
		const schemaVersion = (project as unknown as Readonly<Record<string, unknown>>).schemaVersion;
		if (!isTakeCompProjectSchema(schemaVersion)) {
			throw new RangeError(`Take comps require schema V17 or V21, received ${String(schemaVersion)}.`);
		}
		if (schemaVersion === 17) validateAudioEditorProjectV17(project);
		else createTakeCompDocumentGroupsV17(
			(project as unknown as Readonly<Record<string, unknown>>).takeGroups,
			project as unknown as Readonly<Record<string, unknown>>,
		);
		return project;
	}
}

function canonicalGroups(project: AudioEditorProjectV17): readonly TakeCompDocumentGroup[] {
	return createTakeCompDocumentGroupsV17(project.takeGroups, project as unknown as Record<string, unknown>);
}

function requireGroup(project: AudioEditorProjectV17, groupIdValue: string): TakeCompDocumentGroup {
	const groupId = normalizeTakeCompGroupId(groupIdValue);
	const groups = canonicalGroups(project);
	const index = groupIndex(groups, groupId);
	return groups[index]!;
}

function groupIndex(groups: readonly TakeCompDocumentGroup[], groupId: string): number {
	const index = groups.findIndex((candidate) => candidate.id === groupId);
	if (index < 0) throw new ReferenceError(`Unknown take group: ${groupId}.`);
	return index;
}

function assertTrackWritable(project: AudioEditorProjectV17, trackId: string): void {
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!track) throw new ReferenceError(`Unknown take group track: ${trackId}.`);
	if (track.locked === true) throw new RangeError(`Track ${trackId} is locked.`);
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

function documentGroupWithCore(
	current: TakeCompDocumentGroup,
	next: TakeCompGroup,
): TakeCompDocumentGroup {
	const takeById = new Map(current.takes.map((take) => [take.id, take]));
	return {
		id: next.id,
		sequenceId: current.sequenceId,
		trackId: current.trackId,
		startSample: next.startSample,
		endSample: next.endSample,
		laneOrder: next.laneOrder,
		lanes: next.lanes,
		takes: next.takes.map(({ id }) => takeById.get(id)!),
		compRegions: next.compRegions,
	};
}

function commandObject(value: object): CommandObject {
	return value as unknown as CommandObject;
}
