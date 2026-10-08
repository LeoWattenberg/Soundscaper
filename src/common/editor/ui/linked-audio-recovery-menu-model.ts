/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import { isCurrentProjectSchemaIdentity, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY }
	from '../project-schema-identity.ts';
import type { RuntimeClipProject } from '../runtime-clip-projection.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface LinkedAudioRecoveryMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editBlocked: boolean;
	readonly copy: Readonly<{ unlinkAudio: string }>;
}

interface LinkedAudioRecoveryMenuItem {
	readonly id: string;
	readonly documentationId: string;
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

interface LinkedAudioRecoveryMenuItems {
	readonly link: Readonly<LinkedAudioRecoveryMenuItem> | null;
	readonly visibility: null;
}

const EMPTY_ITEMS: Readonly<LinkedAudioRecoveryMenuItems> = Object.freeze({ link: null, visibility: null });

/** Soundscaper may detach imported camera audio without composing picture authoring. */
export function createLinkedAudioRecoveryMenuItems(
	input: LinkedAudioRecoveryMenuInput,
	actions: Readonly<{ unlink(clipId: string): unknown }>,
): Readonly<LinkedAudioRecoveryMenuItems> {
	if (input.productId !== 'soundscaper'
		|| !isCurrentProjectSchemaIdentity(input.project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) {
		return EMPTY_ITEMS;
	}
	let project: DataRecord | null = null;
	try {
		project = projectForLinkedAudioRecovery(input.project);
	} catch {
		// Corrupt or unsupported carriers must leave the recovery action inert.
	}
	const tracks = recordArray(project?.tracks);
	const clips = recordArray(project?.clips);
	const selected = clips.find(clip => clip.id === input.selectedClipId);
	if (!selected || selected.kind !== 'audio' || !validRange(selected)
		|| trackForClip(tracks, String(selected.id))?.type !== 'audio'
		|| typeof selected.avLinkId !== 'string' || !selected.avLinkId
		|| !validLinkedPair(tracks, clips, selected.avLinkId)) return EMPTY_ITEMS;
	const clipId = String(selected.id);
	const disabled = input.editBlocked;
	return Object.freeze({
		link: Object.freeze({
			id: 'video-linked-audio', documentationId: 'video-unlink-audio',
			label: input.copy.unlinkAudio, disabled,
			onClick: () => disabled ? undefined : actions.unlink(clipId),
		}),
		visibility: null,
	});
}

function projectForLinkedAudioRecovery(project: unknown): DataRecord {
	return projectForRuntimeConsumers(project as RuntimeClipProject) as unknown as DataRecord;
}

function validLinkedPair(
	tracks: readonly DataRecord[],
	clips: readonly DataRecord[],
	avLinkId: string,
): boolean {
	const linked = clips.filter(clip => clip.avLinkId === avLinkId);
	if (linked.length !== 2) return false;
	const video = linked.find(clip => clip.kind === 'video');
	const audio = linked.find(clip => clip.kind === 'audio');
	if (!video || !audio || !validRange(video) || !validRange(audio)
		|| video.timelineStartFrame !== audio.timelineStartFrame
		|| video.timelineEndFrame !== audio.timelineEndFrame) return false;
	const videoTrack = trackForClip(tracks, String(video.id));
	const audioTrack = trackForClip(tracks, String(audio.id));
	return Boolean(
		videoTrack?.type === 'video' && audioTrack?.type === 'audio'
		&& typeof videoTrack.laneGroupId === 'string' && videoTrack.laneGroupId
		&& videoTrack.laneGroupId === audioTrack.laneGroupId,
	);
}

function trackForClip(tracks: readonly DataRecord[], clipId: string): DataRecord | null {
	const matches = tracks.filter(track => Array.isArray(track.clipIds) && track.clipIds.includes(clipId));
	return matches.length === 1 ? matches[0]! : null;
}

function validRange(clip: DataRecord): boolean {
	return Number.isSafeInteger(clip.timelineStartFrame)
		&& Number(clip.timelineStartFrame) >= 0
		&& Number.isSafeInteger(clip.timelineEndFrame)
		&& Number(clip.timelineEndFrame) > Number(clip.timelineStartFrame);
}

function recordArray(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.filter((item): item is DataRecord => (
		item !== null && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}
