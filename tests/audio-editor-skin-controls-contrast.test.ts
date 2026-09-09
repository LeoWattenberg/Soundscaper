/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { readableTextColor, wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

function contrast(foreground: string, background: string, minimum: number, label: string): void {
	const ratio = wcagContrastRatio(foreground, background);
	assert.ok(ratio >= minimum, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)} (needs ${minimum})`);
}

for (const skin of ['sakura', 'lilac', 'techno'] as const) {
	for (const mode of ['light', 'dark'] as const) {
		const theme = resolveSkinTheme(skin, mode);
		const surfaces = {
			...theme.background.surface,
			toolbar: theme.background.toolbar,
			dialog: theme.background.dialog.body,
			footer: theme.background.dialog.footer,
			menu: theme.background.menu.background,
			track: theme.background.trackHeader.idle,
			selectedTrack: theme.background.trackHeader.selected,
			rail: theme.background.trackHeader.parent,
		};
		test(`${skin}/${mode}: text, checkbox boundaries and focus on editor surfaces`, () => {
			for (const [name, fill] of Object.entries(surfaces)) {
				for (const role of ['primary', 'secondary'] as const) {
					contrast(theme.foreground.text[role], fill, 4.5, `${name}/${role}`);
				}
				contrast(theme.border.control.checkbox, fill, 3, `${name}/checkbox boundary`);
				contrast(theme.border.focus, fill, 3, `${name}/focus ring`);
			}
		});
		test(`${skin}/${mode}: button labels on idle, hover and pressed fills`, () => {
			for (const variant of ['primary', 'secondary'] as const) {
				const fills = theme.background.control.button[variant];
				const text = variant === 'primary'
					? readableTextColor(fills.idle, [theme.foreground.text.primary, theme.foreground.text.inverse])
					: theme.foreground.text.primary;
				for (const state of ['idle', 'hover', 'active'] as const) {
					contrast(text, fills[state], 4.5, `${variant}/${state}`);
				}
			}
		});
		test(`${skin}/${mode}: checkbox marks across interactive states`, () => {
			for (const state of ['idle', 'hover', 'pressed', 'checked', 'checkedHover'] as const) {
				contrast(theme.foreground.icon.primary, theme.background.control.checkbox[state], 3, `checkbox/${state}`);
			}
		});
		test(`${skin}/${mode}: menu and input text across interactive states`, () => {
			for (const state of ['hover', 'pressed', 'active'] as const) {
				contrast(theme.foreground.text.primary, theme.background.menu.item[state], 4.5, `menu/${state}`);
			}
			for (const state of ['idle', 'hover', 'focus'] as const) {
				contrast(theme.foreground.text.primary, theme.background.control.input[state], 4.5, `input/${state}`);
			}
		});
		test(`${skin}/${mode}: vertical scale labels and ticks on the canvas surface`, () => {
			for (const text of [theme.foreground.text.contrastPrimary, theme.foreground.text.contrastSecondary]) {
				contrast(text, theme.background.canvas.default, 4.5, 'scale label');
			}
			for (const tick of Object.values(theme.stroke.ruler)) {
				contrast(tick, theme.background.canvas.default, 3, 'scale tick');
			}
		});
	}
}
