/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { darkTheme, lightTheme } from '@audacity-ui/tokens';
import { SKIN_IDS } from '../src/common/editor/skin-preferences.ts';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

test('Default and high contrast use the original theme objects without mutation', () => {
	const before = JSON.stringify([lightTheme, darkTheme]);
	for (const mode of ['light', 'dark'] as const) {
		const original = mode === 'dark' ? darkTheme : lightTheme;
		assert.equal(resolveSkinTheme('default', mode), original);
		for (const skin of SKIN_IDS) {
			resolveSkinTheme(skin, mode);
			assert.equal(resolveSkinTheme(skin, mode, true), original);
		}
	}
	assert.equal(JSON.stringify([lightTheme, darkTheme]), before);
});

test('every decorative skin has readable text, button states and distinct clip identities', () => {
	for (const skin of ['sakura', 'lilac', 'techno'] as const) {
		for (const mode of ['light', 'dark'] as const) {
			const theme = resolveSkinTheme(skin, mode);
			for (const surface of Object.values(theme.background.surface)) {
				for (const text of [theme.foreground.text.primary, theme.foreground.text.secondary]) {
					assert.ok(wcagContrastRatio(text, surface) >= 4.5, `${skin}/${mode}: ${text} on ${surface}`);
				}
			}
			const fills = theme.background.control.button.primary;
			const candidates = [theme.foreground.text.primary, theme.foreground.text.inverse];
			assert.ok(candidates.some((text) => [fills.idle, fills.hover, fills.active].every((fill) => wcagContrastRatio(text, fill) >= 4.5)), `${skin}/${mode} primary button states`);
			const headers = new Set<string>();
			for (const [id, clip] of Object.entries(theme.audio.clip)) {
				if (!('header' in clip)) continue;
				if (id !== 'classic') headers.add(clip.header);
				for (const fill of [clip.header, clip.headerHover, clip.headerSelected, clip.headerSelectedHover, clip.timeSelectionHeader]) {
					assert.ok(wcagContrastRatio('#14151a', fill) >= 4.5, `${skin}/${mode}/${id} clip label`);
				}
				assert.ok(wcagContrastRatio(clip.waveform, clip.body) >= 3, `${skin}/${mode}/${id} waveform`);
				assert.ok(wcagContrastRatio(clip.waveformSelected, clip.headerSelected) >= 4.5, `${skin}/${mode}/${id} selected`);
			}
			assert.equal(headers.size, 9);
		}
	}
});
