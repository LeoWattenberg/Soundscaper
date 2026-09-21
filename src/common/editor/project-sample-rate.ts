/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE = 8_000;
export const AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE = 768_000;

export function isAudioEditorProjectSampleRate(value: unknown): value is number {
	return Number.isSafeInteger(value)
		&& Number(value) >= AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE
		&& Number(value) <= AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE;
}

/** Strict project-domain admission used by document and media factories. */
export function normalizeProjectSampleRate(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError('project.sampleRate must be a positive safe integer.');
	}
	if (!isAudioEditorProjectSampleRate(value)) {
		throw new RangeError(
			`project.sampleRate must be between ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} and ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`,
		);
	}
	return Number(value);
}
