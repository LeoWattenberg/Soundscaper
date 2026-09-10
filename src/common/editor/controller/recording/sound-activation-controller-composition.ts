/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundActivationPolicyService,
	type SoundActivationPreferencePatch,
	type SoundActivationPolicyRecordingState,
} from './sound-activation-policy-service.ts';

interface SoundActivationControllerState extends SoundActivationPolicyRecordingState {
	readonly preferences: Readonly<{
		readonly recording: Readonly<{ readonly soundActivation: unknown }>;
	}>;
}

type PreferenceUpdate = (
	patch: SoundActivationPreferencePatch,
) => PromiseLike<unknown> | unknown;

/** Compose controller preferences and capture state behind the policy port. */
export function createControllerSoundActivationPolicy(
	state: SoundActivationControllerState,
	updatePreferences: PreferenceUpdate,
	publish: () => void,
) {
	return createSoundActivationPolicyService({
		state,
		getPreferences: () => state.preferences.recording.soundActivation,
		updatePreferences,
		publish,
	});
}
