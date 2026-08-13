/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../edit-blocking.ts';
import {
	createTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from '../take-comp-document-v17.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface TakeCompDialogModelInput {
	readonly productId: string;
	readonly project: unknown;
	readonly snapshot: AudioEditorEditBlockingSnapshot;
	readonly selectedGroupId?: string | null;
}

export interface TakeCompDialogTakeModel {
	readonly id: string;
	readonly laneId: string;
	readonly sourceName: string;
	readonly startSample: number;
	readonly endSample: number;
}

export interface TakeCompDialogLaneModel {
	readonly id: string;
	readonly takes: readonly TakeCompDialogTakeModel[];
}

export interface TakeCompDialogGroupModel extends TakeCompDocumentGroup {
	readonly trackName: string;
	readonly locked: boolean;
	readonly lanesView: readonly TakeCompDialogLaneModel[];
}

export interface TakeCompDialogModel {
	readonly groups: readonly TakeCompDialogGroupModel[];
	readonly selectedGroup: TakeCompDialogGroupModel | null;
	readonly operationsBlocked: boolean;
	readonly blockReason: 'read-only' | 'busy' | 'locked' | null;
}

export interface TakeCompNumberEntry {
	readonly draft: string | null;
	readonly value: number | null;
}

/**
 * Value identity of the take geometry a dialog holds drafts for. Every snapshot publication
 * rebuilds the model objects, so drafts may only be discarded when this identity changes.
 */
export function takeCompDialogDraftIdentity(group: TakeCompDialogGroupModel | null): string {
	if (!group) return '';
	return JSON.stringify([
		group.id, group.startSample, group.endSample,
		group.takes.map(({ id, startSample, endSample }) => [id, startSample, endSample]),
		group.compRegions.map(({ id, takeId, startSample, endSample }) => [id, takeId, startSample, endSample]),
	]);
}

/** Resolve one integer-field edit, holding transient text rather than committing an unentered value. */
export function readTakeCompNumberEntry(text: string): Readonly<TakeCompNumberEntry> {
	const trimmed = text.trim();
	const value = Number(trimmed);
	if (!trimmed || !Number.isSafeInteger(value)) return Object.freeze({ draft: text, value: null });
	return Object.freeze({ draft: null, value });
}

/** Validate and project V17 take state into one snapshot-owned dialog model. */
export function createTakeCompDialogModel(input: TakeCompDialogModelInput): Readonly<TakeCompDialogModel> {
	if (input.productId !== 'soundscaper') return emptyModel();
	const project = dataRecord(input.project);
	if (!project || project.schemaVersion !== 17) return emptyModel();
	const canonical = createTakeCompDocumentGroupsV17(project.takeGroups, project);
	const tracks = dataRecords(project.tracks);
	const sources = dataRecords(project.sources);
	const sourceNames = new Map(sources.map((source) => [String(source.id), String(source.name ?? source.id)]));
	const groups = canonical.map((group): TakeCompDialogGroupModel => {
		const track = tracks.find(({ id }) => id === group.trackId);
		const takes = group.takes.map((take): TakeCompDialogTakeModel => Object.freeze({
			id: take.id,
			laneId: take.laneId,
			sourceName: sourceNames.get(take.sourceId) ?? take.id,
			startSample: take.startSample,
			endSample: take.endSample,
		}));
		return Object.freeze({
			...group,
			trackName: String(track?.name ?? group.trackId),
			locked: track?.locked === true,
			lanesView: Object.freeze(group.laneOrder.map((laneId) => Object.freeze({
				id: laneId,
				takes: Object.freeze(takes.filter((take) => take.laneId === laneId)),
			}))),
		});
	});
	const selectedGroup = groups.find(({ id }) => id === input.selectedGroupId) ?? groups[0] ?? null;
	const editBlock = selectAudioEditorEditBlock(input.snapshot);
	const blockReason = selectedGroup?.locked === true
		? 'locked' as const
		: editBlock.blocked
			? editBlock.reason === 'read-only' ? 'read-only' as const : 'busy' as const
			: null;
	return Object.freeze({
		groups: Object.freeze(groups),
		selectedGroup,
		operationsBlocked: blockReason !== null,
		blockReason,
	});
}

function emptyModel(): Readonly<TakeCompDialogModel> {
	return Object.freeze({ groups: Object.freeze([]), selectedGroup: null, operationsBlocked: true, blockReason: null });
}

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function dataRecords(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(dataRecord).filter((record): record is DataRecord => record !== null) : [];
}
