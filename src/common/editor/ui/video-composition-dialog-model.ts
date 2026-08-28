/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectAudioEditorEditBlock, type AudioEditorEditBlockingSnapshot } from '../edit-blocking.ts';
import { isFramescaperVideoCompositionProjectSchema } from '../project-schema-version.ts';
import {
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from '../video-clip-composition.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface VideoCompositionDialogModelInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<{
		readonly selectedClipId?: unknown;
	}>;
}

export interface VideoCompositionDialogModel {
	readonly clipId: string | null;
	readonly clipName: string;
	readonly composition: VideoClipComposition | null;
	readonly operationsBlocked: boolean;
	readonly blockReason: 'unsupported' | 'no-video-clip' | 'read-only' | 'busy' | 'locked' | null;
}

export interface SelectedVideoCompositionClip {
	readonly clipId: string;
	readonly clipName: string;
	readonly composition: VideoClipComposition;
	readonly locked: boolean;
}

export interface VideoCompositionDraft {
	readonly cropLeftPercent: string;
	readonly cropTopPercent: string;
	readonly cropRightPercent: string;
	readonly cropBottomPercent: string;
	readonly anchorXPercent: string;
	readonly anchorYPercent: string;
	readonly positionXPercent: string;
	readonly positionYPercent: string;
	readonly scaleXPercent: string;
	readonly scaleYPercent: string;
	readonly rotationDegrees: string;
	readonly flipHorizontal: boolean;
	readonly flipVertical: boolean;
	readonly opacityPercent: string;
	readonly blendMode: string;
	readonly compositingOrder: string;
}

export interface VideoCompositionSetCommand {
	readonly type: 'video-composition/set';
	readonly clipId: string;
	readonly expectedComposition: VideoClipComposition;
	readonly composition: VideoClipComposition;
}
export interface VideoCompositionBatchCommand {
	readonly type: 'batch';
	readonly commands: readonly VideoCompositionSetCommand[];
}

/** Project the selected timeline video clip from a composition-owning document. */
export function resolveSelectedVideoCompositionClip(
	projectValue: unknown,
	selectedClipIdValue: unknown,
): Readonly<SelectedVideoCompositionClip> | null {
	const project = dataRecord(projectValue);
	if (!project || !isFramescaperVideoCompositionProjectSchema(project)) return null;
	const selectedClipIds = selectedIds(project, selectedClipIdValue);
	if (selectedClipIds.length !== 1) return null;
	const clips = dataRecords(project.clips);
	const tracks = dataRecords(project.tracks);
	const clip = clips.find(({ id, kind }) => id === selectedClipIds[0] && kind === 'video') ?? null;
	const owners = clip ? tracks.filter((track) => (
		track.type === 'video' && Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)
	)) : [];
	if (!clip || owners.length !== 1 || typeof clip.id !== 'string') return null;
	try {
		return Object.freeze({
			clipId: clip.id,
			clipName: String(clip.title ?? clip.name ?? clip.id),
			composition: normalizeVideoClipComposition(clip.videoComposition),
			locked: owners[0]?.locked === true,
		});
	} catch {
		return null;
	}
}

/** Derive dialog enablement without consulting mutable controller state. */
export function createVideoCompositionDialogModel(
	input: VideoCompositionDialogModelInput,
): Readonly<VideoCompositionDialogModel> {
	const project = dataRecord(input.project);
	if (input.productId !== 'framescaper' || !input.capability
		|| !isFramescaperVideoCompositionProjectSchema(project)) {
		return emptyModel('unsupported');
	}
	const selected = resolveSelectedVideoCompositionClip(input.project, input.snapshot.selectedClipId);
	if (!selected) return emptyModel('no-video-clip');
	const editBlock = selectAudioEditorEditBlock(input.snapshot);
	const blockReason = selected.locked
		? 'locked' as const
		: editBlock.blocked
			? editBlock.reason === 'read-only' ? 'read-only' as const : 'busy' as const
			: null;
	return Object.freeze({
		clipId: selected.clipId,
		clipName: selected.clipName,
		composition: selected.composition,
		operationsBlocked: blockReason !== null,
		blockReason,
	});
}

/** Convert the persisted fractions/multipliers into user-facing percentage strings. */
export function createVideoCompositionDraft(value: unknown): Readonly<VideoCompositionDraft> {
	const composition = normalizeVideoClipComposition(value);
	return Object.freeze({
		cropLeftPercent: displayNumber(composition.crop.left * 100),
		cropTopPercent: displayNumber(composition.crop.top * 100),
		cropRightPercent: displayNumber(composition.crop.right * 100),
		cropBottomPercent: displayNumber(composition.crop.bottom * 100),
		anchorXPercent: displayNumber(composition.transform.anchorX * 100),
		anchorYPercent: displayNumber(composition.transform.anchorY * 100),
		positionXPercent: displayNumber((composition.transform.positionX - 0.5) * 100),
		positionYPercent: displayNumber((composition.transform.positionY - 0.5) * 100),
		scaleXPercent: displayNumber(composition.transform.scaleX * 100),
		scaleYPercent: displayNumber(composition.transform.scaleY * 100),
		rotationDegrees: displayNumber(composition.transform.rotationDegrees),
		flipHorizontal: composition.transform.flipHorizontal,
		flipVertical: composition.transform.flipVertical,
		opacityPercent: displayNumber(composition.opacity * 100),
		blendMode: composition.blendMode,
		compositingOrder: String(composition.compositingOrder),
	});
}

/** Parse all dialog fields together so invalid intermediate edits never reach history. */
export function parseVideoCompositionDraft(draft: VideoCompositionDraft): VideoClipComposition {
	return normalizeVideoClipComposition({
		schemaVersion: 1,
		crop: {
			left: numberText(draft.cropLeftPercent, 'crop left') / 100,
			top: numberText(draft.cropTopPercent, 'crop top') / 100,
			right: numberText(draft.cropRightPercent, 'crop right') / 100,
			bottom: numberText(draft.cropBottomPercent, 'crop bottom') / 100,
		},
		transform: {
			anchorX: numberText(draft.anchorXPercent, 'anchor X') / 100,
			anchorY: numberText(draft.anchorYPercent, 'anchor Y') / 100,
			positionX: numberText(draft.positionXPercent, 'position X') / 100 + 0.5,
			positionY: numberText(draft.positionYPercent, 'position Y') / 100 + 0.5,
			scaleX: numberText(draft.scaleXPercent, 'scale X') / 100,
			scaleY: numberText(draft.scaleYPercent, 'scale Y') / 100,
			rotationDegrees: numberText(draft.rotationDegrees, 'rotation'),
			flipHorizontal: draft.flipHorizontal,
			flipVertical: draft.flipVertical,
		},
		opacity: numberText(draft.opacityPercent, 'opacity') / 100,
		blendMode: draft.blendMode,
		compositingOrder: numberText(draft.compositingOrder, 'compositing order'),
	});
}

/** Snapshot both optimistic values into the exact shared controller command. */
export function createVideoCompositionSetCommand(
	clipId: string,
	expectedComposition: unknown,
	composition: unknown,
): Readonly<VideoCompositionSetCommand> {
	if (!clipId.trim()) throw new TypeError('video composition clipId must be a non-empty string.');
	return Object.freeze({
		type: 'video-composition/set',
		clipId,
		expectedComposition: normalizeVideoClipComposition(expectedComposition, 'expected video composition'),
		composition: normalizeVideoClipComposition(composition),
	});
}

/** Keep an implicit transition's shared blend/order state valid in one publication. */
export function createVideoCompositionCommitCommand(
	projectValue: unknown,
	clipId: string,
	expectedComposition: unknown,
	composition: unknown,
): Readonly<VideoCompositionSetCommand | VideoCompositionBatchCommand> {
	const primary = createVideoCompositionSetCommand(clipId, expectedComposition, composition);
	if (primary.expectedComposition.blendMode === primary.composition.blendMode
		&& primary.expectedComposition.compositingOrder === primary.composition.compositingOrder) {
		return primary;
	}
	const project = dataRecord(projectValue);
	const clips = dataRecords(project?.clips);
	const clip = clips.find(({ id }) => id === clipId);
	const track = dataRecords(project?.tracks).find(({ type, clipIds }) => (
		type === 'video' && Array.isArray(clipIds) && clipIds.includes(clipId)
	));
	if (!clip || !track || !Array.isArray(track.clipIds)) return primary;
	const peers = track.clipIds.map((id) => clips.find((candidate) => candidate.id === id))
		.filter((candidate): candidate is DataRecord => candidate !== undefined)
		.filter((candidate) => candidate.id !== clipId && clipsOverlap(clip, candidate));
	if (peers.length !== 1) return primary;
	const peer = peers[0] as DataRecord;
	const peerComposition = normalizeVideoClipComposition(peer.videoComposition);
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze([
			primary,
			createVideoCompositionSetCommand(String(peer.id), peerComposition, {
				...peerComposition,
				blendMode: primary.composition.blendMode,
				compositingOrder: primary.composition.compositingOrder,
			}),
		]),
	});
}

function emptyModel(
	blockReason: Exclude<VideoCompositionDialogModel['blockReason'], null>,
): Readonly<VideoCompositionDialogModel> {
	return Object.freeze({
		clipId: null, clipName: '', composition: null,
		operationsBlocked: true, blockReason,
	});
}

function selectedIds(project: DataRecord, selectedClipId: unknown): readonly string[] {
	const selection = dataRecord(project.selection);
	if (Array.isArray(selection?.clipIds) && selection.clipIds.length > 0) {
		if (!selection.clipIds.every((id) => typeof id === 'string')) return Object.freeze([]);
		if (typeof selectedClipId === 'string' && selection.clipIds.includes(selectedClipId)) {
			const focused = dataRecords(project.clips).find(({ id }) => id === selectedClipId);
			const selectedVideoCount = selection.clipIds.filter((id) => (
				dataRecords(project.clips).some((clip) => clip.id === id && clip.kind === 'video')
			)).length;
			if (focused?.kind === 'video' && selectedVideoCount === 1) return Object.freeze([selectedClipId]);
		}
		return selection.clipIds;
	}
	return typeof selectedClipId === 'string' ? Object.freeze([selectedClipId]) : Object.freeze([]);
}

function numberText(value: string, name: string): number {
	if (!value.trim()) throw new TypeError(`${name} must be a finite number.`);
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number.`);
	return number;
}

function displayNumber(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const rounded = Number(value.toPrecision(12));
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function dataRecords(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(dataRecord).filter((item): item is DataRecord => item !== null) : [];
}

function clipsOverlap(left: DataRecord, right: DataRecord): boolean {
	const leftStart = clipStartFrame(left);
	const rightStart = clipStartFrame(right);
	const leftEnd = leftStart + clipFrameCount(left);
	const rightEnd = rightStart + clipFrameCount(right);
	return [leftStart, rightStart, leftEnd, rightEnd].every(Number.isFinite)
		&& Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd);
}

function clipStartFrame(clip: DataRecord): number {
	return Number(clip.sequenceStartFrame ?? clip.timelineStartFrame);
}

function clipFrameCount(clip: DataRecord): number {
	return Number(clip.sequenceFrameCount ?? clip.durationFrames);
}
