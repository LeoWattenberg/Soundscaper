/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { darkTheme, lightTheme } from '@audacity-ui/tokens';
import { SKIN_IDS } from '../src/common/editor/skin-preferences.ts';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

test('Default and high contrast skins use the original theme objects without mutation', () => {
	const before = JSON.stringify([lightTheme, darkTheme]);
	for (const mode of ['light', 'dark'] as const) {
		const original = mode === 'dark' ? darkTheme : lightTheme;
		assert.equal(resolveSkinTheme('default', mode), original);
		for (const skin of SKIN_IDS) {
			resolveSkinTheme(skin, mode);
		}
		assert.equal(resolveSkinTheme('high-contrast', mode), original);
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

for (const mode of ['light', 'dark'] as const) test(`Sakura/${mode} colors time displays, track meters and ruler regions`, () => {
	const theme = resolveSkinTheme('sakura', mode);
	const base = mode === 'dark' ? darkTheme : lightTheme;
	const expected = {
		light: {
			timecode: '#dfabc2', timeline: '#f5dfe8', selection: '#e3b4c9',
			loopFill: '#e9c3d4', loopFillInactive: '#f1d5e0',
			meterBackground: '#eac5d5', meterFill: '#ac316a',
		},
		dark: {
			timecode: '#744e63', timeline: '#392536', selection: '#6b475c',
			loopFill: '#593b4e', loopFillInactive: '#452d3f',
			meterBackground: '#57394d', meterFill: '#ffaccd',
		},
	}[mode];
	assert.deepEqual({
		timecode: theme.background.control.timecode.idle,
		timeline: theme.background.panel.timeline,
		selection: theme.audio.selection.time,
		loopFill: theme.audio.timeline.loopRegionFill,
		loopFillInactive: theme.audio.timeline.loopRegionFillInactive,
		meterBackground: theme.background.control.meter.background,
		meterFill: theme.background.control.meter.fill,
	}, expected);
	for (const color of [theme.background.control.timecode.idle, theme.background.panel.timeline,
		theme.audio.selection.time, theme.audio.timeline.loopRegionFill, theme.audio.timeline.loopRegionFillInactive]) {
		assert.ok(wcagContrastRatio(theme.foreground.text.primary, color) >= 4.5, `ruler/timecode text on ${color}`);
	}
	assert.ok(wcagContrastRatio(theme.background.control.meter.fill, theme.background.control.meter.background) >= 3);
	assert.ok(wcagContrastRatio(theme.audio.timeline.loopRegionBorder, theme.audio.timeline.loopRegionFill) >= 3);
	assert.equal(theme.semantic.error.background, base.semantic.error.background);
});
