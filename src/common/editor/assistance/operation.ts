/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed operation vocabulary shared by renderer-independent and desktop contracts. */
export const ASSISTANCE_OPERATIONS = Object.freeze([
	'voice-activity-detection',
	'speech-recognition',
	'word-alignment',
	'speaker-diarization',
	'speech-enhancement',
	'dereverberation',
	'source-separation',
	'audio-tagging',
	'beat-tracking',
	'text-embedding',
	'image-text-embedding',
	'optical-character-recognition',
	'shot-detection',
	'subject-detection',
	'saliency-detection',
	'editorial-generation',
] as const);

export type AssistanceOperation = typeof ASSISTANCE_OPERATIONS[number];

const OPERATION_SET = new Set<unknown>(ASSISTANCE_OPERATIONS);

export function isAssistanceOperation(value: unknown): value is AssistanceOperation {
	return OPERATION_SET.has(value);
}

export function normalizeAssistanceOperation(value: unknown): AssistanceOperation {
	if (!isAssistanceOperation(value)) {
		throw new TypeError('The assistance operation is unsupported.');
	}
	return value;
}
