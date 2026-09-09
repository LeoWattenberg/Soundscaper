/* SPDX-License-Identifier: AGPL-3.0-only */
import { oneOf } from './preferences-validators.js';
import { normalizeSkin, type SkinId } from './skin-preferences.ts';

export const AUDIO_EDITOR_THEMES = Object.freeze([
	'system',
	'light',
	'dark',
	'high-contrast-light',
	'high-contrast-dark',
]);
export const AUDIO_EDITOR_CLIP_STYLES = Object.freeze(['classic', 'colorful']);
export const AUDIO_EDITOR_LAYOUTS = Object.freeze(['auto', 'compact', 'desktop']);
/**
 * Audacity's "Default View Mode": the display a track gets when nothing has
 * given it one of its own. Upstream also offers waveform in decibels; this
 * editor draws waveforms on a linear scale only, so it offers the three
 * displays its timeline can actually render.
 */
export const AUDIO_EDITOR_DEFAULT_VIEWS = Object.freeze(['waveform', 'spectrogram', 'multiview']);

const THEME_SET = new Set(AUDIO_EDITOR_THEMES);
const CLIP_STYLE_SET = new Set(AUDIO_EDITOR_CLIP_STYLES);
const LAYOUT_SET = new Set(AUDIO_EDITOR_LAYOUTS);
const DEFAULT_VIEW_SET = new Set(AUDIO_EDITOR_DEFAULT_VIEWS);

export interface AppearancePreferences {
	skin: SkinId;
	theme: string;
	clipStyle: 'classic' | 'colorful';
	layout: 'auto' | 'compact' | 'desktop';
	defaultView: 'waveform' | 'spectrogram' | 'multiview';
}

export function normalizeAppearancePreferences(options?: Record<string, unknown>): AppearancePreferences {
	return {
		skin: normalizeSkin(options?.skin),
		theme: oneOf(options?.theme ?? 'system', THEME_SET, 'appearance.theme'),
		clipStyle: oneOf(options?.clipStyle ?? 'colorful', CLIP_STYLE_SET, 'appearance.clipStyle'),
		// 'auto' follows the viewport width; the explicit values force the
		// compact (drawer) or desktop chrome regardless of window size.
		layout: oneOf(options?.layout ?? 'auto', LAYOUT_SET, 'appearance.layout'),
		// The display new sessions start every track in; a track given a
		// display of its own keeps it.
		defaultView: oneOf(options?.defaultView ?? 'waveform', DEFAULT_VIEW_SET, 'appearance.defaultView'),
	};
}
