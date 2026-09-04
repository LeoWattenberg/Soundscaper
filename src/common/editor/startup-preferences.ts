/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Audacity's General preferences carry a "Program start" section deciding what
 * the application opens with. Audacity's four modes collapse to three here:
 * Soundscaper has no start screen, so its "start empty" and "start with a new
 * score" would be the same empty project, and only the new project survives.
 */
export const AUDIO_EDITOR_STARTUP_MODES = Object.freeze([
	'continue-last-session',
	'new-project',
	'project',
] as const);

export type AudioEditorStartupMode = (typeof AUDIO_EDITOR_STARTUP_MODES)[number];

export interface AudioEditorStartupPreferences {
	readonly mode: AudioEditorStartupMode;
	readonly projectId: string;
}

export const AUDIO_EDITOR_DEFAULT_STARTUP_MODE: AudioEditorStartupMode = 'continue-last-session';

/**
 * Resolves the project the next session opens with. A named project that no
 * longer exists resolves to no project rather than to the last session, which
 * is what a caller opening nothing does: it starts a new project.
 */
export function resolveStartupProjectId(
	startup: Partial<AudioEditorStartupPreferences> | null | undefined,
	lastProjectId: string | null | undefined,
): string | null {
	const mode = startup?.mode ?? AUDIO_EDITOR_DEFAULT_STARTUP_MODE;
	if (mode === 'new-project') return null;
	if (mode === 'project') return startup?.projectId || null;
	return lastProjectId || null;
}
