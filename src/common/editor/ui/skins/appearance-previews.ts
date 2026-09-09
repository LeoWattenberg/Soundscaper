/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2021 MuseScore BVBA and others.
 * Adapted from Audacity's ThemeSample.qml: QML geometry translated to SVG,
 * with Soundscaper skin tokens. See previews/NOTICE.md for provenance.
 */
import type { SkinId } from '../../skin-preferences.ts';
import { resolveSkinTheme } from './skin-themes.ts';

/** Audacity's theme sample: inset window, text card and neutral/accent buttons. */
export function appearancePreview(skin: SkinId, mode: 'light' | 'dark', highContrast = false): string {
	const theme = resolveSkinTheme(skin, mode, highContrast);
	const background = theme.background.surface.default;
	const panel = theme.background.surface.elevated;
	const stroke = theme.border.default;
	const text = theme.foreground.text.primary;
	const button = theme.background.control.button.secondary.idle;
	const accent = theme.accent.primary;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 64" fill="none">
<rect width="88" height="64" rx="2" fill="${background}"/>
<path d="M12 8H88V62Q88 64 86 64H12Z" fill="${panel}" stroke="${stroke}"/>
<rect x="16" y="12" width="68" height="32" rx="2" fill="${background}" stroke="${stroke}"/>
<g fill="${text}"><rect x="23" y="19" width="54" height="3" rx="1.5"/><rect x="23" y="26" width="54" height="3" rx="1.5"/><rect x="23" y="33" width="36" height="3" rx="1.5"/></g>
<rect x="16" y="48" width="32" height="12" rx="2" fill="${button}" stroke="${stroke}"/>
<rect x="52" y="48" width="32" height="12" rx="2" fill="${accent}" stroke="${stroke}"/>
<rect x=".5" y=".5" width="87" height="63" rx="2" stroke="${stroke}"/>
</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
