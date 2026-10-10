/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createEditorPreferenceActionDelegates } from './internal/preferences-service.ts';
import type { createPreferencesComposition } from './preferences-composition.ts';
import { createDefaultTrackViewPreferenceAction } from './internal/default-track-view-preference-action.ts';

type RuntimeAction = (...args: unknown[]) => unknown;
type PreferenceActions = ReturnType<typeof createEditorPreferenceActionDelegates>;
const preferenceActionOwners = new WeakSet<object>();

/** Preserve the owning composition's exact frozen delegates through action assembly. */
export function createEditorPreferenceActionOwner<Actions extends PreferenceActions>(actions: Actions): Actions {
	Object.freeze(actions);
	preferenceActionOwners.add(actions);
	return actions;
}

export type EditorPreferenceActionOwner = ReturnType<typeof createPreferencesComposition>['actions'];

export function assertEditorPreferenceActionOwner(value: unknown): asserts value is EditorPreferenceActionOwner {
	if (!value || typeof value !== 'object') throw new TypeError('Missing editor action dependency: preferenceActions.');
	if (!preferenceActionOwners.has(value)) throw new TypeError('Invalid editor action dependency: preferenceActions.');
}

/**
 * The preferences action group.
 *
 * Extracted from the action facade because preferences are where the editor
 * grows: every new setting the Preferences dialog offers wants a line here, and
 * the facade sits at the maintainability ceiling where each one costs a split.
 */

export interface PreferenceActionScope {
	readonly preferenceActions: EditorPreferenceActionOwner;
	readonly AUDIO_EDITOR_DEFAULT_SHORTCUTS: unknown;
	readonly updatePreferences: (changes: unknown) => unknown;
	readonly setTimelineView: (view: unknown) => unknown;
	readonly state: Readonly<{ timelineView: string }>;
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
	const { updatePreferences, setTimelineView, preferenceActions } = scope;
	return Object.freeze({
		update: recordingPreferences.update,
		revertFactorySettings: recordingPreferences.revertFactorySettings,
		setWorkspace: preferenceActions.setWorkspacePreference,
		setSkin: (skin: unknown) => updatePreferences({ appearance: { skin } }),
		setTheme: (theme: unknown) => updatePreferences({ appearance: { theme } }),
		setClipStyle: (clipStyle: unknown) => updatePreferences({ appearance: { clipStyle } }),
		setLayout: (layout: unknown) => updatePreferences({ appearance: { layout } }),
		// The default view is the timeline's view: tracks without a display of
		// their own follow it, so the session adopts the new default at once
		// rather than at the next launch.
		setDefaultView: createDefaultTrackViewPreferenceAction({
			updatePreferences, setTimelineView, getTimelineView: () => scope.state.timelineView,
		}),
		toggleToolbar: preferenceActions.toggleToolbarPreference,
		moveToolbar: preferenceActions.moveToolbarPreference,
		setToolbarButton: preferenceActions.setToolbarButtonPreference,
		togglePanel: preferenceActions.togglePanelPreference,
		setPanel: preferenceActions.setPanelPreference,
		setPanelVisibility: preferenceActions.setPanelVisibilityPreference,
		setPanelFrameSize: preferenceActions.setPanelFrameSizePreference,
		setPanelDockExtent: preferenceActions.setPanelDockExtentPreference,
		movePanel: preferenceActions.movePanelPreference,
		activatePanelTab: preferenceActions.activatePanelTabPreference,
		setShortcut: preferenceActions.setShortcutPreference,
		resetShortcuts: () => updatePreferences({ shortcuts: scope.AUDIO_EDITOR_DEFAULT_SHORTCUTS }),
		createWorkspace: preferenceActions.createWorkspacePreference,
		updateWorkspace: preferenceActions.updateWorkspacePreference,
		deleteWorkspace: preferenceActions.deleteWorkspacePreference,
	});
}
