/* SPDX-License-Identifier: AGPL-3.0-only */

/** The display a track is drawn as before anyone gives it one of its own. */
export const AUDIO_EDITOR_FALLBACK_TIMELINE_VIEW = 'waveform';

interface PreferenceSessionState {
	timelineView: string;
}

interface AppearancePreferences {
	readonly appearance?: { readonly defaultView?: string } | null;
}

/**
 * Start a session in the state its stored preferences describe.
 *
 * Some preferences are read once, at load, because they seed session state
 * rather than being consulted where they are used: the timeline view is what a
 * track without a display of its own is drawn as, so the stored default view is
 * applied by starting the session in it. This lives beside the preferences
 * service rather than in the composition root, which is being decomposed one
 * concern at a time.
 */
export function applyLoadedPreferenceSession<Preferences extends AppearancePreferences>(
	preferences: Preferences,
	state: PreferenceSessionState,
): Preferences {
	state.timelineView = preferences.appearance?.defaultView || AUDIO_EDITOR_FALLBACK_TIMELINE_VIEW;
	return preferences;
}
