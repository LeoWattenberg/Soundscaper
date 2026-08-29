/* SPDX-License-Identifier: AGPL-3.0-only */

export const DIRECT_WAV_TARGET_PATHS = Object.freeze([
	'/private/smoke/completed.wav',
	'/private/smoke/cancelled.wav',
	'/private/smoke/completed.aiff',
	'/private/smoke/completed-bwf.wav',
	'/private/smoke/completed-bw64.wav',
]);

export function validDesktopDirectWavRendererResult(overrides = {}) {
	return {
		imported: true,
		completed: true,
		cancelled: true,
		aiffCompleted: true,
		bwfCompleted: true,
		bw64Completed: true,
		realtimeCount: 5,
		downloadVisible: false,
		...overrides,
	};
}

export function validDesktopDirectWavNativeEvidence({
	selectionPurposes = Array.from({ length: 5 }, () => 'audio-pcm-mix'),
	...overrides
} = {}) {
	return {
		selectionPurposes: [...selectionPurposes],
		completedBytes: 202_752_044,
		completedAiffBytes: 202_752_054,
		completedBwfBytes: 202_752_766,
		completedBw64Bytes: 202_755_508,
		aiffChoiceValidated: true,
		bwfChoiceValidated: true,
		bw64ChoiceValidated: true,
		cancelledAbsent: true,
		stagingFilesRemaining: 0,
		...overrides,
	};
}
