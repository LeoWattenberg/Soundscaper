/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION = 11 as const;
export const AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION = 12 as const;
export const AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION = 13 as const;
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;

export function isTimelineAnnotationProjectSchema(value: unknown): value is 11 | 12 | 13 {
	return value === AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION;
}

export function isTrackFolderProjectSchema(value: unknown): value is 12 | 13 {
	return value === AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION;
}
