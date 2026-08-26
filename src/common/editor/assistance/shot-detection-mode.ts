/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed mode and detector identities for Mark Cuts. */

export const LOCAL_ASSISTANCE_SHOT_DETECTION_MODES = Object.freeze([
	'fast', 'accurate',
] as const);

export const LOCAL_ASSISTANCE_SHOT_DETECTORS = Object.freeze([
	'ffmpeg-scdet', 'transnetv2',
] as const);

export const LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID = 'transnetv2';
export const LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK = 'shot-detection';

export type LocalAssistanceShotDetectionMode =
	typeof LOCAL_ASSISTANCE_SHOT_DETECTION_MODES[number];
export type LocalAssistanceShotDetector =
	typeof LOCAL_ASSISTANCE_SHOT_DETECTORS[number];

const MODES = new Set<unknown>(LOCAL_ASSISTANCE_SHOT_DETECTION_MODES);
const DETECTORS = new Set<unknown>(LOCAL_ASSISTANCE_SHOT_DETECTORS);

export function normalizeLocalAssistanceShotDetectionMode(
	value: unknown,
): LocalAssistanceShotDetectionMode {
	if (!MODES.has(value)) throw new TypeError('The Mark Cuts mode is unsupported.');
	return value as LocalAssistanceShotDetectionMode;
}

export function normalizeLocalAssistanceShotDetector(
	value: unknown,
): LocalAssistanceShotDetector {
	if (!DETECTORS.has(value)) throw new TypeError('The shot detector is unsupported.');
	return value as LocalAssistanceShotDetector;
}
