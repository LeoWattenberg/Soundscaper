/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createPreferencesComposition } from './preferences-composition.ts';

type RuntimeAction = (...args: unknown[]) => unknown;
type PreferenceActions = ReturnType<typeof createPreferencesComposition>['actions'];

/**
 * The preferences action group.
 *
 * Extracted from the action facade because preferences are where the editor
 * grows: every new setting the Preferences dialog offers wants a line here, and
 * the facade sits at the maintainability ceiling where each one costs a split.
 */

export interface PreferenceActionScope extends PreferenceActions {
	readonly AUDIO_EDITOR_DEFAULT_SHORTCUTS: unknown;
	readonly updatePreferences: (changes: unknown) => unknown;
	readonly setTimelineView: (view: unknown) => unknown;
}

/** The recording facade owns the two entries that also revert recording state. */
export interface PreferenceActionRecordingFacade {
	readonly update: RuntimeAction;
	readonly revertFactorySettings: RuntimeAction;
}

export function createPreferenceActionGroup(
	scope: PreferenceActionScope,
	recordingPreferences: PreferenceActionRecordingFacade,
) {
	const { updatePreferences, setTimelineView } = scope;
	return Object.freeze({
		update: recordingPreferences.update,
		revertFactorySettings: recordingPreferences.revertFactorySettings,
		setWorkspace: scope.setWorkspacePreference,
		setTheme: (theme: unknown) => updatePreferences({ appearance: { theme } }),
		setClipStyle: (clipStyle: unknown) => updatePreferences({ appearance: { clipStyle } }),
		setLayout: (layout: unknown) => updatePreferences({ appearance: { layout } }),
		// The default view is the timeline's view: tracks without a display of
		// their own follow it, so the session adopts the new default at once
		// rather than at the next launch.
		setDefaultView: (defaultView: unknown) => {
			const updated = updatePreferences({ appearance: { defaultView } });
			setTimelineView(defaultView);
			return updated;
		},
		toggleToolbar: scope.toggleToolbarPreference,
		moveToolbar: scope.moveToolbarPreference,
		setToolbarButton: scope.setToolbarButtonPreference,
		togglePanel: scope.togglePanelPreference,
		setPanel: scope.setPanelPreference,
		setPanelVisibility: scope.setPanelVisibilityPreference,
		setPanelFrameSize: scope.setPanelFrameSizePreference,
		setPanelDockExtent: scope.setPanelDockExtentPreference,
		movePanel: scope.movePanelPreference,
		activatePanelTab: scope.activatePanelTabPreference,
		setShortcut: scope.setShortcutPreference,
		resetShortcuts: () => updatePreferences({ shortcuts: scope.AUDIO_EDITOR_DEFAULT_SHORTCUTS }),
		createWorkspace: scope.createWorkspacePreference,
		updateWorkspace: scope.updateWorkspacePreference,
		deleteWorkspace: scope.deleteWorkspacePreference,
	});
}
