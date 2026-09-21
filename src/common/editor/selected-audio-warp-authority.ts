/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAudioWarpProjectSchema } from './project-schema-version.ts';

export type AudioWarpSelectionRecord = Readonly<Record<string, unknown>>;

export interface SelectedAudioWarpTarget {
	readonly clipId: string;
	readonly clip: AudioWarpSelectionRecord;
	readonly source: AudioWarpSelectionRecord;
	readonly track: AudioWarpSelectionRecord;
}

export interface SelectedAudioWarpAuthority {
	readonly clip: AudioWarpSelectionRecord | null;
	readonly source: AudioWarpSelectionRecord | null;
	readonly track: AudioWarpSelectionRecord | null;
	readonly target: Readonly<SelectedAudioWarpTarget> | null;
}

/** Resolve the selected audio clip facts shared by the warp menu and dialog. */
export function resolveSelectedAudioWarpAuthority(
	projectValue: unknown,
	selectedClipIdValue: unknown,
): Readonly<SelectedAudioWarpAuthority> | null {
	const project = dataRecord(projectValue);
	if (!project || !isAudioWarpProjectSchema(project)) return null;
	const selectedClipId = typeof selectedClipIdValue === 'string'
		? selectedClipIdValue
		: null;
	const clip = dataRecords(project.clips).find(({ id, kind }) => (
		id === selectedClipId && kind === 'audio'
	)) ?? null;
	const owners = clip ? dataRecords(project.tracks).filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)
	)) : [];
	const track = owners.length === 1 ? owners[0]! : null;
	const source = clip ? dataRecords(project.sources).find(({ id }) => (
		id === clip.sourceId
	)) ?? null : null;
	const target = clip && source && track && clip.reversed !== true
		? Object.freeze({ clipId: String(clip.id), clip, source, track })
		: null;
	return Object.freeze({ clip, source, track, target });
}

function dataRecord(value: unknown): AudioWarpSelectionRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as AudioWarpSelectionRecord
		: null;
}

function dataRecords(value: unknown): readonly AudioWarpSelectionRecord[] {
	return Array.isArray(value)
		? value.map(dataRecord).filter((item): item is AudioWarpSelectionRecord => item !== null)
		: [];
}
