/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CommandObject } from '../commands/protocol.ts';

export type ProjectBinMediaKind = 'audio' | 'video';

export interface ProjectBinVideoEffect extends CommandObject {
	readonly id?: string;
}

/**
 * The project-bin workflow only depends on this stable subset of the project
 * wire format. Extra clip fields remain on the runtime object when it is
 * spread into a command; naming the fields used here keeps the service from
 * becoming a second, loosely typed project schema.
 */
export interface ProjectBinClip {
	readonly id: string;
	readonly sourceId: string;
	readonly title: string;
	readonly kind?: ProjectBinMediaKind;
	readonly binItemId?: string | null;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
	readonly videoEffects?: readonly ProjectBinVideoEffect[];
}

export interface ProjectBinSource {
	readonly id: string;
	readonly kind?: ProjectBinMediaKind;
	readonly sampleRate?: number;
	readonly frameCount: number;
	readonly channelCount?: number;
}

export interface ProjectBinTrack {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly name?: string;
	readonly clipIds: readonly string[];
	readonly laneGroupId?: string | null;
}

export interface ProjectBinSelection {
	readonly clipIds?: readonly string[];
}

export interface ProjectBinProject {
	readonly schemaVersion: number;
	readonly id: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly sources: readonly ProjectBinSource[];
	readonly clips: readonly ProjectBinClip[];
	readonly tracks: readonly ProjectBinTrack[];
	readonly projectBin?: Readonly<{ readonly clips: readonly ProjectBinClip[] }>;
	readonly selection?: ProjectBinSelection | null;
}

export interface ProjectBinPreview {
	readonly clipId: string;
	readonly binItemId: string;
	readonly state: 'playing' | 'paused' | 'stopped';
	readonly kind: ProjectBinMediaKind;
	readonly mediaUrl?: string | null;
}

export interface ProjectBinVisualData {
	readonly mediaUrl?: string | null;
}

export interface ProjectBinCopy {
	readonly audioClipNotFound: string;
	readonly localSourcesMissing: string;
	readonly track: string;
	readonly projectBinReplacementIncompatible?: string;
}

export interface ProjectBinDocumentSnapshot {
	readonly history: unknown;
	readonly project: ProjectBinProject;
}

export interface ProjectBinImportResult {
	readonly clipId: string;
}

export interface ProjectBinReplacementPreparation {
	readonly token: string;
	readonly requiresChoice: boolean;
	readonly shortenedClipIds: readonly string[];
}

export interface ProjectBinReplacementEntry {
	readonly oldSourceId: string;
	readonly newSourceId: string;
}

export type ProjectBinReplacementShortfallMode = 'keep-spacing' | 'contract-gaps';

export function projectBinClips(project: ProjectBinProject): readonly ProjectBinClip[] {
	return Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
}

export function findProjectBinClip(
	project: ProjectBinProject,
	clipId: string,
): ProjectBinClip | null {
	return projectBinClips(project).find((clip) => clip.id === clipId) ?? null;
}

export function findProjectBinSource(
	project: ProjectBinProject,
	sourceId: string,
): ProjectBinSource | null {
	return project.sources.find((source) => source.id === sourceId) ?? null;
}

export function findProjectBinTrack(
	project: ProjectBinProject,
	trackId: string | null | undefined,
): ProjectBinTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

export function findProjectBinClipTrack(
	project: ProjectBinProject,
	clipId: string,
): ProjectBinTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

export function projectBinMediaKind(clip: ProjectBinClip): ProjectBinMediaKind {
	return clip.kind === 'video' ? 'video' : 'audio';
}
