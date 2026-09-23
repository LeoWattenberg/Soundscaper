/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	frequencyWaveformPaletteColor,
	frequencyWaveformRmsColor,
	frequencyWaveformTheme,
} from '../src/common/editor/ui/timeline/frequency-waveform-palette.ts';
import { wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

function hex(color: string): string {
	const channels = color.match(/\d+/gu);
	assert.equal(channels?.length, 3);
	return `#${channels!.map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
}

test('every interpolated spectral color contrasts with neutral and selected skin surfaces', () => {
	for (const theme of ['light', 'dark'] as const) {
		// Decorative skins share the neutral ground; high contrast uses white/black.
		const backgrounds = theme === 'dark'
			? ['#20252c', '#343b45', '#000000', '#242a32']
			: ['#f3f4f6', '#e1e4ea', '#ffffff'];
		for (let step = 0; step <= 200; step += 1) {
			const frequency = 100 * 220.5 ** (step / 200);
			const color = frequencyWaveformPaletteColor(frequency, 1, 48_000, theme);
			const rms = frequencyWaveformRmsColor(color, theme);
			assert.notEqual(color, rms);
			for (const background of backgrounds) {
				assert.ok(wcagContrastRatio(hex(color), background) >= 3,
					`${theme} ${frequency} Hz: ${color} against ${background}`);
				assert.ok(wcagContrastRatio(hex(rms), background) >= 3,
					`${theme} RMS ${frequency} Hz against ${background}`);
			}
		}
	}
});

test('resolved color scheme changes the ramp and silence stays neutral', () => {
	assert.equal(frequencyWaveformTheme({ colorScheme: 'dark' }), 'dark');
	assert.equal(frequencyWaveformTheme({ colorScheme: 'light' }), 'light');
	assert.equal(frequencyWaveformTheme({ colorScheme: '' }), 'light');
	for (const theme of ['light', 'dark'] as const) {
		assert.equal(frequencyWaveformPaletteColor(0, 0, 48_000, theme),
			frequencyWaveformPaletteColor(20_000, 0, 48_000, theme));
		assert.equal(frequencyWaveformPaletteColor(1, 1, 48_000, theme),
			frequencyWaveformPaletteColor(100, 1, 48_000, theme));
		assert.equal(frequencyWaveformPaletteColor(40_000, 1, 96_000, theme),
			frequencyWaveformPaletteColor(22_050, 1, 96_000, theme));
	}
	assert.notEqual(frequencyWaveformPaletteColor(1_000, 1, 48_000, 'dark'),
		frequencyWaveformPaletteColor(1_000, 1, 48_000, 'light'));
});
