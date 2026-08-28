/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../edit-blocking.ts';
import { isAudioWarpProjectSchema } from '../project-schema-version.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface AudioWarpDialogModelInput {
	readonly productId: string;
	readonly project: unknown;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<{ readonly selectedClipId?: unknown }>;
}

export interface AudioWarpDialogModel {
	readonly clipId: string | null;
	readonly clipName: string;
	readonly sourceName: string;
	readonly hasWarpMap: boolean;
	readonly warpPoints: readonly Readonly<{ index: number; outer: string; source: string }>[];
	readonly operationsBlocked: boolean;
	readonly blockReason: 'no-audio-clip' | 'read-only' | 'busy' | 'locked' | null;
}

/** Project one selected audio clip from the immutable workspace snapshot. */
export function createAudioWarpDialogModel(input: AudioWarpDialogModelInput): Readonly<AudioWarpDialogModel> {
	if (input.productId !== 'soundscaper') return emptyModel();
	const project = dataRecord(input.project);
	if (!project || !isAudioWarpProjectSchema(project)) return emptyModel();
	const selectedClipId = typeof input.snapshot.selectedClipId === 'string'
		? input.snapshot.selectedClipId
		: null;
	const clips = dataRecords(project.clips);
	const tracks = dataRecords(project.tracks);
	const sources = dataRecords(project.sources);
	const clip = clips.find(({ id, kind }) => id === selectedClipId && kind === 'audio') ?? null;
	const owners = clip ? tracks.filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)
	)) : [];
	const source = clip ? sources.find(({ id }) => id === clip.sourceId) ?? null : null;
	const editBlock = selectAudioEditorEditBlock(input.snapshot);
	const blockReason = !clip || !source || owners.length !== 1 || clip.reversed === true
		? 'no-audio-clip' as const
		: owners[0]?.locked === true
			? 'locked' as const
			: editBlock.blocked
				? editBlock.reason === 'read-only' ? 'read-only' as const : 'busy' as const
				: null;
	const warpMap = dataRecord(clip?.warpMap);
	return Object.freeze({
		clipId: clip && source && owners.length === 1 ? String(clip.id) : null,
		clipName: clip ? String(clip.title ?? clip.name ?? clip.id) : '',
		sourceName: source ? String(source.name ?? source.id) : '',
		hasWarpMap: warpMap !== null,
		warpPoints: Object.freeze(dataRecords(warpMap?.points).map((point, index) => Object.freeze({
			index,
			outer: rationalLabel(point.outer),
			source: rationalLabel(point.source),
		}))),
		operationsBlocked: blockReason !== null,
		blockReason,
	});
}

function emptyModel(): Readonly<AudioWarpDialogModel> {
	return Object.freeze({
		clipId: null, clipName: '', sourceName: '', hasWarpMap: false,
		warpPoints: Object.freeze([]), operationsBlocked: true, blockReason: 'no-audio-clip',
	});
}

function rationalLabel(value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	const rational = dataRecord(value);
	return Number.isSafeInteger(rational?.num) && Number.isSafeInteger(rational?.den)
		? `${String(rational!.num)}/${String(rational!.den)}`
		: '';
}

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function dataRecords(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(dataRecord).filter((item): item is DataRecord => item !== null) : [];
}
