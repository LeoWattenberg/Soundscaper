/* SPDX-License-Identifier: AGPL-3.0-only */

import { isFramescaperVideoRetimeProjectSchema } from '../project-schema-version.ts';

export type VideoRetimeDialogBlockReason = 'unsupported' | 'no-video-clip' | 'locked' | 'busy';

export interface VideoRetimeDialogModelInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
}

export interface VideoRetimeDialogModel {
	readonly blockReason: VideoRetimeDialogBlockReason | null;
	readonly clipId: string | null;
	readonly clipName: string;
	readonly hasRetimeMap: boolean;
	readonly commandAuthority: Readonly<{
		readonly clipId: string;
		readonly expectedRetimeMap: unknown;
	}> | null;
	readonly bounds: Readonly<{
		readonly outerFrameCount: number;
		readonly sourceFirstFrame: number;
		readonly sourceLastFrame: number;
	}> | null;
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Resolve one timeline occurrence and snapshot the stale-command fence for the lazy dialog. */
export function createVideoRetimeDialogModel(
	input: VideoRetimeDialogModelInput,
): Readonly<VideoRetimeDialogModel> {
	if (input.productId !== 'framescaper' || !input.capability) return blocked('unsupported');
	const project = record(input.project);
	if (!isFramescaperVideoRetimeProjectSchema(project)) {
		return blocked('unsupported');
	}
	const clips = records(project?.clips);
	const tracks = records(project?.tracks);
	const selection = record(project?.selection);
	const selectedIds = strings(selection?.clipIds);
	let targetIds = selectedIds.length > 0
		? selectedIds
		: input.selectedClipId ? [input.selectedClipId] : [];
	if (input.selectedClipId && selectedIds.includes(input.selectedClipId)) {
		const focused = clips.find(({ id }) => id === input.selectedClipId);
		const selectedVideos = selectedIds.filter((id) => (
			clips.find((clip) => clip.id === id)?.kind === 'video'
		));
		if (focused?.kind === 'video' && selectedVideos.length === 1) targetIds = [input.selectedClipId];
	}
	if (targetIds.length !== 1) return blocked('no-video-clip');
	const clip = clips.find(({ id }) => id === targetIds[0]);
	if (!clip || clip.kind !== 'video' || !Object.hasOwn(clip, 'retimeMap')) return blocked('no-video-clip');
	const owners = tracks.filter(({ type, clipIds }) => type === 'video' && strings(clipIds).includes(targetIds[0]!));
	if (owners.length !== 1) return blocked('no-video-clip');
	const sequenceFrameCount = positiveInteger(clip.sequenceFrameCount);
	const sourceInFrame = nonNegativeInteger(clip.sourceInFrame);
	const sourceFrameCount = positiveInteger(clip.sourceFrameCount);
	if (sequenceFrameCount === null || sourceInFrame === null || sourceFrameCount === null
		|| !Number.isSafeInteger(sourceInFrame + sourceFrameCount)) return blocked('no-video-clip');
	const expectedRetimeMap = cloneAndFreeze(clip.retimeMap);
	return Object.freeze({
		blockReason: input.editingBlocked ? 'busy' : owners[0]?.locked === true ? 'locked' : null,
		clipId: targetIds[0]!,
		clipName: typeof clip.name === 'string' && clip.name.length > 0 ? clip.name : targetIds[0]!,
		hasRetimeMap: expectedRetimeMap !== null,
		commandAuthority: Object.freeze({ clipId: targetIds[0]!, expectedRetimeMap }),
		bounds: Object.freeze({
			outerFrameCount: sequenceFrameCount,
			sourceFirstFrame: sourceInFrame,
			sourceLastFrame: sourceInFrame + sourceFrameCount,
		}),
	});
}

function blocked(reason: VideoRetimeDialogBlockReason): Readonly<VideoRetimeDialogModel> {
	return Object.freeze({
		blockReason: reason, clipId: null, clipName: '', hasRetimeMap: false,
		commandAuthority: null, bounds: null,
	});
}

function cloneAndFreeze(value: unknown): unknown {
	if (value === null) return null;
	const result = structuredClone(value) as object;
	const pending = [result];
	while (pending.length > 0) {
		const candidate = pending.pop()!;
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
			if (Object.hasOwn(descriptor, 'value') && descriptor.value && typeof descriptor.value === 'object') {
				pending.push(descriptor.value as object);
			}
		}
		Object.freeze(candidate);
	}
	return result;
}

function record(value: unknown): DataRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null ? value as DataRecord : null;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}

function strings(value: unknown): readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function integer(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
	const result = integer(value);
	return result !== null && result >= 0 ? result : null;
}

function positiveInteger(value: unknown): number | null {
	const result = integer(value);
	return result !== null && result > 0 ? result : null;
}
