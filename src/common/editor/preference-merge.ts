/* SPDX-License-Identifier: AGPL-3.0-only */

type PreferenceSection = Readonly<Record<string, unknown>>;

interface MergeablePreferences extends Readonly<Record<string, unknown>> {
	readonly workspace?: PreferenceSection & {
		readonly toolbars?: PreferenceSection;
		readonly toolbarButtons?: PreferenceSection;
		readonly panels?: PreferenceSection;
	};
	readonly editing?: object;
	readonly appearance?: object;
	readonly view?: object;
	readonly spectrogram?: object;
	readonly waveformVisualization?: object;
	readonly waveformDisplay?: object;
	readonly import?: object;
	readonly recording?: object;
	readonly playback?: object;
	readonly effects?: object;
	readonly performance?: object;
	readonly startup?: object;
}

/** Merge section patches, replacing list values while preserving layout records. */
export function mergePreferences(preferences: MergeablePreferences, patch: MergeablePreferences = {}): MergeablePreferences {
	return {
		...preferences,
		...patch,
		editing: { ...preferences.editing, ...patch.editing },
		shortcuts: patch.shortcuts === undefined ? preferences.shortcuts : patch.shortcuts,
		appearance: { ...preferences.appearance, ...patch.appearance },
		view: { ...preferences.view, ...patch.view },
		workspace: {
			...preferences.workspace,
			...patch.workspace,
			toolbars: { ...preferences.workspace?.toolbars, ...patch.workspace?.toolbars },
			toolbarButtons: { ...preferences.workspace?.toolbarButtons, ...patch.workspace?.toolbarButtons },
			panels: { ...preferences.workspace?.panels, ...patch.workspace?.panels },
		},
		spectrogram: { ...preferences.spectrogram, ...patch.spectrogram },
		waveformVisualization: { ...preferences.waveformVisualization, ...patch.waveformVisualization },
		waveformDisplay: { ...preferences.waveformDisplay, ...patch.waveformDisplay },
		import: { ...preferences.import, ...patch.import },
		recording: { ...preferences.recording, ...patch.recording },
		playback: { ...preferences.playback, ...patch.playback },
		effects: { ...preferences.effects, ...patch.effects },
		performance: { ...preferences.performance, ...patch.performance },
		startup: { ...preferences.startup, ...patch.startup },
	};
}
