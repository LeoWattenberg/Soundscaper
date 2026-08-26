/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, versioned cleanup thresholds over authenticated 16 kHz VAD. */

export const ASSISTANCE_TRANSCRIPT_CLEANUP_PRESETS = Object.freeze([
	'conservative', 'balanced', 'aggressive',
] as const);

export type AssistanceTranscriptCleanupPreset =
	typeof ASSISTANCE_TRANSCRIPT_CLEANUP_PRESETS[number];

export interface AssistanceTranscriptCleanupPresetProfile {
	readonly minimumSilenceSamples: number;
	readonly speechPaddingSamples: number;
	readonly minimumWordConfidence: number;
}

const PROFILES = Object.freeze({
	conservative: profile(24_000, 1_600, 0.8),
	balanced: profile(8_000, 800, 0),
	aggressive: profile(4_800, 480, 0),
} satisfies Readonly<Record<
	AssistanceTranscriptCleanupPreset,
	AssistanceTranscriptCleanupPresetProfile
>>);

export function normalizeAssistanceTranscriptCleanupPreset(
	value: unknown,
): AssistanceTranscriptCleanupPreset {
	if (!ASSISTANCE_TRANSCRIPT_CLEANUP_PRESETS.includes(
		value as AssistanceTranscriptCleanupPreset,
	)) {
		throw new TypeError('The transcript cleanup preset is invalid.');
	}
	return value as AssistanceTranscriptCleanupPreset;
}

export function assistanceTranscriptCleanupPresetProfile(
	value: unknown,
): AssistanceTranscriptCleanupPresetProfile {
	return PROFILES[normalizeAssistanceTranscriptCleanupPreset(value)];
}

function profile(
	minimumSilenceSamples: number,
	speechPaddingSamples: number,
	minimumWordConfidence: number,
): AssistanceTranscriptCleanupPresetProfile {
	return Object.freeze({ minimumSilenceSamples, speechPaddingSamples, minimumWordConfidence });
}
