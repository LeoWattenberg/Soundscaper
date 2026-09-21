/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE: 'application/x-soundscaper-project-bin-clip';
export const AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE: 'application/x-soundscaper-freesound-result';

export interface ProjectBinDragPayload {
	readonly projectId: string;
	readonly clipId: string;
}

export function createProjectBinDragPayload(projectId: string, clipId: string): string;
export function parseProjectBinDragPayload(value: string): Readonly<ProjectBinDragPayload> | null;
export function getActiveProjectBinDragPayload(): Readonly<ProjectBinDragPayload> | null;
export function clearActiveProjectBinDragPayload(): void;
export function createFreesoundResultDragPayload(soundId: number): string;
export function parseFreesoundResultDragPayload(value: string): number | null;
