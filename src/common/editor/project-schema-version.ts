/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION = 17 as const;
export const FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION = 19 as const;
export const FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION = 20 as const;
/** Dormant professional-media candidate; never include in shipped-route predicates. */
export const FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION = 25 as const;
/** Dormant isolated-OpenFX candidate; never include in shipped-route predicates. */
export const FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION = 26 as const;
/** Selected Framescaper finishing generation; V25/V26 remain dormant custody. */
export const FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION = 27 as const;
export const SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION = 21 as const;
/** Reserved dormant Framescaper transitions candidate; never a selected shared authority. */
export const FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION = 22 as const;
// 22 is reserved for the planned 4B-3 transitions revision, so the
// mastering-sequence revision takes 23. Several tests use V21 + 1 as their
// "future schema" sentinel, which numbering this 22 would have invalidated.
export const SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION = 23 as const;
/** Reserved dormant Framescaper visual-model candidate; never a selected shared authority. */
export const FRAMESCAPER_PROJECT_V24_SCHEMA_VERSION = 24 as const;
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;

/**
 * Active documents built on the shared foundation the command layer understands.
 *
 * Every product revision keeps that foundation, so this is the same
 * "ask, do not compare" rule as the production predicate below: a command layer
 * gated on an exact revision stops projecting and reconciling for the next one,
 * quietly and without an error.
 */
export function isFoundationProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

/**
 * Documents that carry the Soundscaper production authority: automation lanes,
 * the mixer graph, freeze roots, and no per-strip envelopes.
 *
 * **Ask this rather than comparing against a revision.** Every later Soundscaper
 * revision carries the production authority too, so a gate written as
 * `schemaVersion === 21` silently sends the next revision down the pre-production
 * path — and because most of these gates fall back rather than throw, the
 * symptom is automation that stops being scheduled, a mixer graph that is not
 * built, or per-track envelopes wiped mid-render, with no error anywhere.
 * `retention.js` already learned this the same way and says so at its own gate:
 * "Gating on one exact version leaves every later document unrooted."
 *
 * Per-revision code inside a product directory is the exception and should keep
 * comparing exactly — a V21 validator must accept only V21.
 */
export function isSoundscaperProductionProjectSchema(value: unknown): value is 21 | 23 {
	return value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

/** Documents that execute the shared V21 automation and explicit mixer graph. */
export function isProductionMixerProjectSchema(value: unknown): value is 21 | 23 | 27 {
	return isSoundscaperProductionProjectSchema(value)
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
}

/**
 * Documents whose revision owns a mastering-sequence collection.
 *
 * Narrower than the production authority on purpose: a V21 document carries that
 * authority but has nowhere to put a sequence, so a surface gated on the wider
 * predicate would open on a document where every edit it offers must fail.
 */
export function isMasteringSequenceProjectSchema(value: unknown): value is 23 {
	return value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

/** Framescaper generations that own nested-sequence and multicamera graphs. */
export function isFramescaperSequenceProjectSchema(value: unknown): value is 18 | 19 | 20 | 27 {
	return value === 18
		|| value === FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
}

/** Historical Framescaper generations that own the dormant capture contract. */
export function isFramescaperCaptureProjectSchema(value: unknown): value is 18 | 19 | 20 {
	return value === 18
		|| value === FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION;
}

/** Framescaper generations that own explicit clip composition state. */
export function isFramescaperVideoCompositionProjectSchema(value: unknown): value is 19 | 20 | 27 {
	return value === FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
}

/** Selected Framescaper generations that own explicit video-keyframe curves. */
export function isFramescaperVideoKeyframeProjectSchema(value: unknown): value is 20 | 27 {
	return value === FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
}

/** Selected Framescaper generations that own maintained occurrence-retime authoring. */
export function isFramescaperVideoRetimeProjectSchema(value: unknown): value is 20 | 27 {
	return value === FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
}

/** Active audio-authoring documents: shared V17 and Soundscaper-owned V21/V23. */
export function isActiveAudioEditorProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

export function isTimelineAnnotationProjectSchema(value: unknown): value is 17 | 21 | 23 | 27 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION;
}

export function isTrackFolderProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

export function isSourceCharacteristicsProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

export function isTrackLockProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

export function isVideoRetimeCurveProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

export function isTakeCompProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

/** Exact project generations that persist the V17 audio-warp authority. */
export function isAudioWarpProjectSchema(value: unknown): value is 17 | 21 | 23 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

/** Exact selected-product schemas that persist the maintained feature manifest. */
export function isMaintainedProjectFeatureSchema(value: unknown): value is 17 | 19 | 20 | 21 | 23 | 27 {
	return value === AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION
		|| value === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
		|| value === SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
}

/** Exact maintained product schemas whose closed rendered-fallback roles are understood. */
export function isMaintainedRenderedFallbackProjectSchema(value: unknown): value is 17 | 19 | 20 | 21 | 23 | 27 {
	return isMaintainedProjectFeatureSchema(value);
}
