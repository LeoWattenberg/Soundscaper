/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION = 11 as const;
export const AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION = 12 as const;
export const AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION = 13 as const;
export const AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION = 14 as const;
export const AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION = 15 as const;
export const AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION = 16 as const;
export const AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION = 17 as const;
export const FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION = 19 as const;
export const SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION = 21 as const;
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;

/** Active audio-authoring documents: shared V17 and Soundscaper-owned V21. */
export function isActiveAudioEditorProjectSchema(value: unknown): value is 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

export function isTimelineAnnotationProjectSchema(value: unknown): value is 11 | 12 | 13 | 14 | 15 | 16 | 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

export function isTrackFolderProjectSchema(value: unknown): value is 12 | 13 | 14 | 15 | 16 | 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V12_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

export function isSourceCharacteristicsProjectSchema(value: unknown): value is 14 | 15 | 16 | 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

export function isTrackLockProjectSchema(value: unknown): value is 15 | 16 | 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

export function isVideoRetimeCurveProjectSchema(value: unknown): value is 16 | 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION
		|| value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

export function isTakeCompProjectSchema(value: unknown): value is 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

/** Exact project generations that persist the V17 audio-warp authority. */
export function isAudioWarpProjectSchema(value: unknown): value is 17 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

/** Exact selected-product schemas that persist the maintained feature manifest. */
export function isMaintainedProjectFeatureSchema(value: unknown): value is 17 | 19 | 21 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
}

/** Exact maintained product schemas whose closed rendered-fallback roles are understood. */
export function isMaintainedRenderedFallbackProjectSchema(value: unknown): value is 17 | 19 | 21 {
	return isMaintainedProjectFeatureSchema(value);
}
