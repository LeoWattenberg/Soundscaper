/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import {
	isFramescaperVideoCompositionProjectSchema,
	isTimelineAnnotationProjectSchema,
} from '../project-schema-version.ts';
import type { RuntimeClipProject } from '../runtime-clip-projection.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface FramescaperEditControlCopy {
	readonly linkAudio: string;
	readonly unlinkAudio: string;
	readonly showVideo: string;
	readonly hideVideo: string;
}

export type FramescaperLinkOperation = Readonly<
	| { readonly kind: 'link'; readonly videoClipId: string; readonly audioClipId: string }
	| { readonly kind: 'unlink'; readonly clipId: string }
>;

export interface FramescaperVisibilityOperation {
	readonly trackId: string;
	readonly hidden: boolean;
}

export interface FramescaperEditControlMenuItem<Operation> {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly operation: Readonly<Operation> | null;
}

export interface FramescaperEditControlMenuModel {
	readonly link: Readonly<FramescaperEditControlMenuItem<FramescaperLinkOperation>> | null;
	readonly visibility: Readonly<FramescaperEditControlMenuItem<FramescaperVisibilityOperation>> | null;
}

export interface FramescaperEditControlMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly selectedTrackId: string | null;
	readonly editBlocked: boolean;
	readonly copy: FramescaperEditControlCopy;
}

export interface FramescaperEditControlActions {
	link(videoClipId: string, audioClipId: string): unknown;
	unlink(clipId: string): unknown;
	setVideoHidden(trackId: string, hidden: boolean): unknown;
}

export interface FramescaperApplicationMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface FramescaperEditControlMenuItems {
	readonly link: Readonly<FramescaperApplicationMenuItem> | null;
	readonly visibility: Readonly<FramescaperApplicationMenuItem> | null;
}

/** Derive fail-closed menu state without owning document or command behavior. */
export function createFramescaperEditControlMenuModel(
	input: FramescaperEditControlMenuInput,
): Readonly<FramescaperEditControlMenuModel> {
	if (input.productId !== 'framescaper') return Object.freeze({ link: null, visibility: null });
	const persistedProject = record(input.project);
	let project: DataRecord | null = null;
	try {
		project = persistedProject === null ? null : projectForLinkedControls(persistedProject);
	} catch {
		// A menu must stay inert instead of rejecting an unprojectable document.
	}
	const tracks = recordArray(project?.tracks);
	const clips = recordArray(project?.clips);
	const linkOperation = resolveLinkOperation(tracks, clips, input.selectedClipId);
	const visibilityOperation = resolveVisibilityOperation(tracks, input.selectedTrackId);
	return Object.freeze({
		link: menuItem<FramescaperLinkOperation>(
			'video-linked-audio',
			linkOperation?.kind === 'unlink' ? input.copy.unlinkAudio : input.copy.linkAudio,
			input.editBlocked || linkOperation === null,
			linkOperation,
		),
		visibility: menuItem<FramescaperVisibilityOperation>(
			'video-track-visibility',
			visibilityOperation?.hidden === false ? input.copy.showVideo : input.copy.hideVideo,
			input.editBlocked || visibilityOperation === null,
			visibilityOperation,
		),
	});
}

function projectForLinkedControls(project: DataRecord): DataRecord {
	if (!isFramescaperVideoCompositionProjectSchema(project.schemaVersion)) {
		return projectForRuntimeConsumers(project as RuntimeClipProject) as unknown as DataRecord;
	}
	if (!Array.isArray(project.timelineAnnotations) || project.timelineAnnotations.length !== 0) {
		throw new TypeError('Framescaper composition projects require an empty timeline annotation carrier.');
	}
	const projectionInput = { ...project };
	if (!isTimelineAnnotationProjectSchema(project.schemaVersion)) {
		delete projectionInput.timelineAnnotations;
	}
	return projectForRuntimeConsumers(projectionInput as RuntimeClipProject) as unknown as DataRecord;
}

/** Bind the derived state to the already-owned controller actions. */
export function createFramescaperEditControlMenuItems(
	input: FramescaperEditControlMenuInput,
	actions: FramescaperEditControlActions,
): Readonly<FramescaperEditControlMenuItems> {
	const model = createFramescaperEditControlMenuModel(input);
	return Object.freeze({
		link: model.link === null ? null : applicationMenuItem(model.link, () => {
			const operation = model.link?.operation;
			if (model.link?.disabled || !operation) return undefined;
			return operation.kind === 'link'
				? actions.link(operation.videoClipId, operation.audioClipId)
				: actions.unlink(operation.clipId);
		}),
		visibility: model.visibility === null ? null : applicationMenuItem(model.visibility, () => {
			const operation = model.visibility?.operation;
			return model.visibility?.disabled || !operation
				? undefined
				: actions.setVideoHidden(operation.trackId, operation.hidden);
		}),
	});
}

function resolveLinkOperation(
	tracks: readonly DataRecord[],
	clips: readonly DataRecord[],
	selectedClipId: string | null,
): FramescaperLinkOperation | null {
	const selected = clips.find((clip) => clip.id === selectedClipId);
	if (!selected || !mediaKind(selected.kind) || !validRange(selected)) return null;
	const selectedTrack = trackForClip(tracks, String(selected.id));
	if (!selectedTrack || selectedTrack.type !== selected.kind) return null;
	if (typeof selected.avLinkId === 'string' && selected.avLinkId) {
		return validLinkedPair(tracks, clips, selected.avLinkId)
			? Object.freeze({ kind: 'unlink', clipId: String(selected.id) })
			: null;
	}
	if (selected.avLinkId !== null || typeof selectedTrack.laneGroupId !== 'string'
		|| !selectedTrack.laneGroupId) return null;
	const oppositeKind = selected.kind === 'video' ? 'audio' : 'video';
	const companionTracks = tracks.filter((track) => (
		track.type === oppositeKind
		&& track.laneGroupId === selectedTrack.laneGroupId
		&& Array.isArray(track.clipIds)
	));
	if (companionTracks.length !== 1) return null;
	const companionIds = new Set(companionTracks[0]!.clipIds as readonly unknown[]);
	const candidates = clips.filter((clip) => (
		clip.kind === oppositeKind
		&& typeof clip.id === 'string'
		&& clip.id.length > 0
		&& companionIds.has(clip.id)
		&& trackForClip(tracks, clip.id) === companionTracks[0]
		&& clip.avLinkId === null
		&& validRange(clip)
		&& clip.timelineStartFrame === selected.timelineStartFrame
		&& clip.timelineEndFrame === selected.timelineEndFrame
	));
	if (candidates.length !== 1) return null;
	const companion = candidates[0]!;
	return Object.freeze(selected.kind === 'video'
		? { kind: 'link', videoClipId: String(selected.id), audioClipId: String(companion.id) }
		: { kind: 'link', videoClipId: String(companion.id), audioClipId: String(selected.id) });
}

function validLinkedPair(
	tracks: readonly DataRecord[],
	clips: readonly DataRecord[],
	avLinkId: string,
): boolean {
	const linked = clips.filter((clip) => clip.avLinkId === avLinkId);
	if (linked.length !== 2) return false;
	const video = linked.find((clip) => clip.kind === 'video');
	const audio = linked.find((clip) => clip.kind === 'audio');
	if (!video || !audio || !validRange(video) || !validRange(audio)
		|| video.timelineStartFrame !== audio.timelineStartFrame
		|| video.timelineEndFrame !== audio.timelineEndFrame) return false;
	const videoTrack = trackForClip(tracks, String(video.id));
	const audioTrack = trackForClip(tracks, String(audio.id));
	return Boolean(
		videoTrack?.type === 'video'
		&& audioTrack?.type === 'audio'
		&& typeof videoTrack.laneGroupId === 'string'
		&& videoTrack.laneGroupId
		&& videoTrack.laneGroupId === audioTrack.laneGroupId,
	);
}

function resolveVisibilityOperation(
	tracks: readonly DataRecord[],
	selectedTrackId: string | null,
): Readonly<FramescaperVisibilityOperation> | null {
	const track = tracks.find((candidate) => candidate.id === selectedTrackId);
	if (!track || track.type !== 'video' || typeof track.hidden !== 'boolean') return null;
	return Object.freeze({ trackId: String(track.id), hidden: !track.hidden });
}

function trackForClip(tracks: readonly DataRecord[], clipId: string): DataRecord | null {
	const matches = tracks.filter((track) => Array.isArray(track.clipIds) && track.clipIds.includes(clipId));
	return matches.length === 1 ? matches[0]! : null;
}

function menuItem<Operation extends object>(
	id: string,
	label: string,
	disabled: boolean,
	operation: Readonly<Operation> | null,
): Readonly<FramescaperEditControlMenuItem<Operation>> {
	return Object.freeze({ id, label, disabled, operation });
}

function applicationMenuItem<Operation>(
	item: Readonly<FramescaperEditControlMenuItem<Operation>>,
	onClick: () => unknown,
): Readonly<FramescaperApplicationMenuItem> {
	return Object.freeze({ id: item.id, label: item.label, disabled: item.disabled, onClick });
}

function validRange(clip: DataRecord): boolean {
	return Number.isSafeInteger(clip.timelineStartFrame)
		&& Number(clip.timelineStartFrame) >= 0
		&& Number.isSafeInteger(clip.timelineEndFrame)
		&& Number(clip.timelineEndFrame) > Number(clip.timelineStartFrame);
}

function mediaKind(value: unknown): value is 'audio' | 'video' {
	return value === 'audio' || value === 'video';
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function recordArray(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}
