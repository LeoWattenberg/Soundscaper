/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_EDITOR_TRACK_DISPLAY_MODES, type TrackDisplayMode } from './track-display-mode.ts';
import { oneOf } from './preferences-validators.js';
import { normalizeSkin, type SkinId } from './skin-preferences.ts';

export const AUDIO_EDITOR_THEMES = Object.freeze([
	'system',
	'light',
	'dark',
]);
export const AUDIO_EDITOR_CLIP_STYLES = Object.freeze(['classic', 'colorful']);
export const AUDIO_EDITOR_LAYOUTS = Object.freeze(['auto', 'compact', 'desktop']);
/** Default display for tracks that have no individual display override. */
export const AUDIO_EDITOR_DEFAULT_VIEWS = AUDIO_EDITOR_TRACK_DISPLAY_MODES;

const THEME_SET = new Set(AUDIO_EDITOR_THEMES);
const CLIP_STYLE_SET = new Set(AUDIO_EDITOR_CLIP_STYLES);
const LAYOUT_SET = new Set(AUDIO_EDITOR_LAYOUTS);
const DEFAULT_VIEW_SET = new Set(AUDIO_EDITOR_DEFAULT_VIEWS);

export interface AppearancePreferences {
	skin: SkinId;
	theme: string;
	clipStyle: 'classic' | 'colorful';
	layout: 'auto' | 'compact' | 'desktop';
	defaultView: TrackDisplayMode;
}

export function normalizeAppearancePreferences(options?: Record<string, unknown>): AppearancePreferences {
	const legacyContrast = options?.theme === 'high-contrast-light' || options?.theme === 'high-contrast-dark';
	return {
		skin: legacyContrast ? 'high-contrast' : normalizeSkin(options?.skin),
		theme: oneOf(legacyContrast ? options.theme === 'high-contrast-dark' ? 'dark' : 'light' : options?.theme ?? 'system', THEME_SET, 'appearance.theme'),
		clipStyle: oneOf(options?.clipStyle ?? 'colorful', CLIP_STYLE_SET, 'appearance.clipStyle'),
		// 'auto' follows the viewport width; the explicit values force the
		// compact (drawer) or desktop chrome regardless of window size.
		layout: oneOf(options?.layout ?? 'auto', LAYOUT_SET, 'appearance.layout'),
		// The display new sessions start every track in; a track given a
		// display of its own keeps it.
		defaultView: oneOf(options?.defaultView ?? 'waveform', DEFAULT_VIEW_SET, 'appearance.defaultView'),
	};
}
