/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE: 'application/x-soundscaper-project-bin-clip';
export const AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE: 'application/x-soundscaper-freesound-result';
export const AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE: 'application/x-soundscaper-timeline-audio-clip';

export interface ProjectBinDragPayload {
	readonly projectId: string;
	readonly clipId: string;
}

export function createProjectBinDragPayload(projectId: string, clipId: string): string;
export function parseProjectBinDragPayload(value: string): Readonly<ProjectBinDragPayload> | null;
export function getActiveProjectBinDragPayload(): Readonly<ProjectBinDragPayload> | null;
export function clearActiveProjectBinDragPayload(): void;
export function createTimelineClipDragPayload(
	projectId: string,
	clipId: string,
	mediaKind: string,
): string;
export function parseTimelineClipDragPayload(value: string): Readonly<ProjectBinDragPayload> | null;
export function getActiveTimelineClipDragPayload(): Readonly<ProjectBinDragPayload> | null;
export function clearActiveTimelineClipDragPayload(): void;
export function writeTimelineClipDragPayload(
	dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>,
	projectId: string,
	clip: Readonly<{ readonly id: string; readonly kind: string; readonly title?: string; readonly name?: string }>,
): boolean;
export function createFreesoundResultDragPayload(soundId: number): string;
export function parseFreesoundResultDragPayload(value: string): number | null;
