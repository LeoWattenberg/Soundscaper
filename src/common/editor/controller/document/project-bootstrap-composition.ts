/* SPDX-License-Identifier: AGPL-3.0-only */

import { RECORDING_INPUT_GAIN_DEFAULT, normalizeRecordingInputGain } from '../../recording.js';
import { resolveStartupProjectId } from '../../startup-preferences.ts';
import { consumeLocaleProjectHandoff, LOCALE_PROJECT_HANDOFF_SETTING } from './locale-project-handoff.ts';
import { isEditorDisposedError, type EditorControllerLifetime } from '../shared/lifecycle.ts';
import { createProjectBootstrapService, type ProjectBootstrapServiceRuntime } from './internal/project/project-bootstrap-service.ts';
import {
	AUDIO_DEVICE_PREFERENCES_SETTING_KEY,
	normalizeAudioDevicePreferences,
	normalizeLatencyOffset,
} from '../recording/recording-model.ts';

type DefaultPort =
	| 'lifetimeSignal' | 'guard' | 'isDisposedError' | 'startupProjectId'
	| 'audioDevicePreferencesSettingKey' | 'recordingInputGainDefault'
	| 'normalizeRecordingInputGain' | 'normalizeLatencyOffset' | 'normalizeAudioDevicePreferences';

export type ProjectBootstrapCompositionDependencies<Project, Preferences, EffectPresets> =
	Omit<ProjectBootstrapServiceRuntime<Project, Preferences, EffectPresets>, DefaultPort> & Readonly<{
		lifetime: EditorControllerLifetime;
		getStartupPreferences(): Parameters<typeof resolveStartupProjectId>[0];
	}>;

/** Bind bootstrap normalization and cancellation to their owning policies. */
export function createProjectBootstrapComposition<Project, Preferences, EffectPresets>(
	dependencies: ProjectBootstrapCompositionDependencies<Project, Preferences, EffectPresets>,
) {
	const { lifetime } = dependencies;
	return createProjectBootstrapService({
		...dependencies, lifetimeSignal: lifetime.signal,
		guard: (value, token) => lifetime.guard(value, token), isDisposedError: isEditorDisposedError,
		startupProjectId: lastProjectId => consumeLocaleProjectHandoff({
			storage: () => globalThis.sessionStorage, location: () => globalThis.location, now: () => Date.now(),
		}, dependencies.productSettingKey(LOCALE_PROJECT_HANDOFF_SETTING))
			?? resolveStartupProjectId(dependencies.getStartupPreferences(), lastProjectId),
		audioDevicePreferencesSettingKey: AUDIO_DEVICE_PREFERENCES_SETTING_KEY,
		recordingInputGainDefault: RECORDING_INPUT_GAIN_DEFAULT,
		normalizeRecordingInputGain, normalizeLatencyOffset, normalizeAudioDevicePreferences,
	});
}
