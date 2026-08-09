/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SoundActivationPolicySnapshot,
	SoundActivationPreferenceMutationBlockReason,
} from '../controller/sound-activation-policy-service.ts';
import {
	SOUND_ACTIVATION_PREFERENCE_LIMITS,
	normalizeSoundActivationPreferences,
	type SoundActivationPreferences,
} from '../sound-activation-preferences.ts';

export const SOUND_ACTIVATION_UI_RANGES = Object.freeze({
	thresholdDb: Object.freeze({
		minimum: SOUND_ACTIVATION_PREFERENCE_LIMITS.minimumThresholdDb,
		maximum: SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumThresholdDb,
		step: 1,
	}),
	hysteresisDb: Object.freeze({
		minimum: 0,
		maximum: SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumHysteresisDb,
		step: 1,
	}),
	holdMilliseconds: Object.freeze({
		minimum: 0,
		maximum: SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumHoldMilliseconds,
		step: 10,
	}),
});

export type SoundActivationUiBlockReason =
	| 'read-only'
	| SoundActivationPreferenceMutationBlockReason;

export interface SoundActivationUiCopy {
	readonly soundActivationGuardReadOnly: string;
	readonly soundActivationGuardPreferenceUpdate: string;
	readonly soundActivationGuardRecordingScheduling: string;
	readonly soundActivationGuardRecordingPrepared: string;
	readonly soundActivationGuardRecordingActive: string;
	readonly soundActivationGuardRecordingFinishing: string;
	readonly soundActivationStatusEnabled: string;
	readonly soundActivationStatusDisabled: string;
	readonly soundActivationDecibelsValue: string;
	readonly soundActivationMillisecondsValue: string;
}

export interface SoundActivationUiModel {
	readonly preferences: SoundActivationPreferences;
	readonly controlsDisabled: boolean;
	readonly preferenceUpdatePending: boolean;
	readonly blockReason: SoundActivationUiBlockReason | null;
	readonly statusMessage: string;
	readonly thresholdValueText: string;
	readonly hysteresisValueText: string;
	readonly holdValueText: string;
}

const BLOCK_COPY_KEYS: Readonly<Record<
	SoundActivationUiBlockReason,
	keyof SoundActivationUiCopy
>> = Object.freeze({
	'read-only': 'soundActivationGuardReadOnly',
	'preference-update': 'soundActivationGuardPreferenceUpdate',
	'recording-scheduling': 'soundActivationGuardRecordingScheduling',
	'recording-prepared': 'soundActivationGuardRecordingPrepared',
	'recording-active': 'soundActivationGuardRecordingActive',
	'recording-finishing': 'soundActivationGuardRecordingFinishing',
});

/** Convert the public policy snapshot into one closed, presentation-only model. */
export function createSoundActivationUiModel(
	policy: SoundActivationPolicySnapshot,
	readOnly: boolean,
	locale: string,
	copy: SoundActivationUiCopy,
): SoundActivationUiModel {
	const preferences = normalizeSoundActivationPreferences(policy.preferences);
	const policyReason = policy.preferenceMutationBlockReason;
	if (policy.preferenceMutationBlocked !== (policyReason !== null)) {
		throw new TypeError('The sound activation preference block reason is inconsistent.');
	}
	const blockReason: SoundActivationUiBlockReason | null = readOnly
		? 'read-only'
		: policyReason;
	const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false });
	const formatValue = (template: string, value: number) => template.replace('{value}', number.format(value));
	return Object.freeze({
		preferences,
		controlsDisabled: blockReason !== null,
		preferenceUpdatePending: policyReason === 'preference-update',
		blockReason,
		statusMessage: blockReason
			? copy[BLOCK_COPY_KEYS[blockReason]]
			: preferences.enabled
				? copy.soundActivationStatusEnabled
				: copy.soundActivationStatusDisabled,
		thresholdValueText: formatValue(copy.soundActivationDecibelsValue, preferences.thresholdDb),
		hysteresisValueText: formatValue(copy.soundActivationDecibelsValue, preferences.hysteresisDb),
		holdValueText: formatValue(copy.soundActivationMillisecondsValue, preferences.holdMilliseconds),
	});
}
