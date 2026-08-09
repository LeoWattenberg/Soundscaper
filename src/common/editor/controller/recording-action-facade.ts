/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundActivationPolicyService } from './sound-activation-policy-service.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../sound-activation-preferences.ts';

type RuntimeAction = (...args: unknown[]) => unknown;
type RestrictedAction = (capability: string, action: RuntimeAction) => RuntimeAction;

export interface RecordingActionScope {
	readonly startRecording: RuntimeAction;
	readonly startRecordingOnNewTrack: RuntimeAction;
	readonly scheduleTimedRecording: RuntimeAction;
	readonly cancelTimedRecording: RuntimeAction;
	readonly toggleRecordingPause: RuntimeAction;
	readonly stopRecording: RuntimeAction;
	readonly toggleLeadInRecording: RuntimeAction;
	readonly setMonitoring: RuntimeAction;
	readonly setMicrophoneMetering: RuntimeAction;
	readonly setRecordingInputGain: RuntimeAction;
	readonly setLatencyOffset: RuntimeAction;
	readonly requestInputAccess: RuntimeAction;
	readonly refreshRecordingInputs: RuntimeAction;
	readonly setRecordingTrackInput: RuntimeAction;
	readonly setRecordingSourceLatency: RuntimeAction;
	readonly setRetainInputs: RuntimeAction;
	readonly releaseInputs: RuntimeAction;
	readonly soundActivationPolicyService: SoundActivationPolicyService;
	readonly updatePreferences: RuntimeAction;
	readonly revertFactorySettings: RuntimeAction;
}

/** Assemble the recording action group without growing the legacy facade. */
export function createRecordingActionFacade(
	scope: RecordingActionScope,
	restricted: RestrictedAction,
) {
	const soundActivation = scope.soundActivationPolicyService;
	return Object.freeze({
		start: restricted('audioRecording', scope.startRecording),
		startNewTrack: restricted('audioRecording', scope.startRecordingOnNewTrack),
		schedule: restricted('audioRecording', scope.scheduleTimedRecording),
		cancelScheduled: scope.cancelTimedRecording,
		pause: scope.toggleRecordingPause,
		stop: scope.stopRecording,
		toggleLeadIn: restricted('audioRecording', scope.toggleLeadInRecording),
		setMonitoring: restricted('audioRecording', scope.setMonitoring),
		setMetering: restricted('audioRecording', scope.setMicrophoneMetering),
		setLevel: restricted('audioRecording', scope.setRecordingInputGain),
		setLatencyOffset: restricted('audioRecording', scope.setLatencyOffset),
		requestInputAccess: restricted('audioRecording', scope.requestInputAccess),
		refreshInputs: restricted('audioRecording', scope.refreshRecordingInputs),
		setTrackInput: restricted('audioRecording', scope.setRecordingTrackInput),
		clearTrackInput: restricted('audioRecording', (trackId) => (
			scope.setRecordingTrackInput(trackId, null)
		)),
		setSourceOffset: restricted('audioRecording', scope.setRecordingSourceLatency),
		setRetainInputs: restricted('audioRecording', scope.setRetainInputs),
		releaseInputs: scope.releaseInputs,
		soundActivation: Object.freeze({
			setEnabled: restricted('audioRecording', soundActivation.setEnabled),
			setThresholdDb: restricted('audioRecording', soundActivation.setThresholdDb),
			setHysteresisDb: restricted('audioRecording', soundActivation.setHysteresisDb),
			setHoldMilliseconds: restricted('audioRecording', soundActivation.setHoldMilliseconds),
		}),
	});
}

/** Keep generic preference actions from bypassing recording-policy ownership. */
export function createRecordingPreferenceActionFacade(
	scope: RecordingActionScope,
	restricted: RestrictedAction,
) {
	const soundActivation = scope.soundActivationPolicyService;
	const guardedFactoryReset = restricted('audioRecording', () => {
		if (soundActivation.getSnapshot().preferenceMutationBlocked) return false;
		return scope.revertFactorySettings();
	});
	return Object.freeze({
		update(patch: unknown) {
			if (ownsSoundActivationPreference(patch)) {
				throw new RangeError(
					'Sound activation preferences must be changed through the dedicated recording sound activation actions.',
				);
			}
			return scope.updatePreferences(patch);
		},
		revertFactorySettings() {
			const snapshot = soundActivation.getSnapshot();
			if (snapshot.preferenceMutationBlockReason === 'preference-update') return false;
			const current = snapshot.preferences;
			if (soundActivationPreferencesEqual(current, DEFAULT_SOUND_ACTIVATION_PREFERENCES)) {
				return scope.revertFactorySettings();
			}
			return guardedFactoryReset();
		},
	});
}

function ownsSoundActivationPreference(value: unknown): boolean {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
	const recording = Object.getOwnPropertyDescriptor(value, 'recording');
	if (!recording) return false;
	if (!('value' in recording)) {
		throw new TypeError('The recording preference patch must contain plain data.');
	}
	const nested = recording.value;
	if ((typeof nested !== 'object' && typeof nested !== 'function') || nested === null) return false;
	return Object.hasOwn(nested, 'soundActivation');
}

function soundActivationPreferencesEqual(
	left: ReturnType<SoundActivationPolicyService['getSnapshot']>['preferences'],
	right: ReturnType<SoundActivationPolicyService['getSnapshot']>['preferences'],
): boolean {
	return left.enabled === right.enabled
		&& left.thresholdDb === right.thresholdDb
		&& left.hysteresisDb === right.hysteresisDb
		&& left.holdMilliseconds === right.holdMilliseconds;
}
