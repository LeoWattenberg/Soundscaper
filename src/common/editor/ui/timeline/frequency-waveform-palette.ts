/* SPDX-License-Identifier: AGPL-3.0-only */

import { FREQUENCY_WAVEFORM_SILENCE_WEIGHT } from '../../frequency-waveform-contract.ts';

export type FrequencyWaveformTheme = 'light' | 'dark';

// Muted indigo, blue, teal, ochre and coral keep adjacent frequencies related.
// Both ramps are opaque: overlapping bands never mix with the clip identity.
const palettes = {
	light: [[99, 80, 155], [48, 111, 166], [33, 130, 112], [157, 111, 36], [176, 76, 69]],
	dark: [[173, 153, 220], [131, 171, 225], [88, 191, 165], [220, 178, 100], [230, 146, 134]],
} as const;

/** Use the resolved editor color scheme, which also follows the system setting. */
export function frequencyWaveformTheme(style: Pick<CSSStyleDeclaration, 'colorScheme'>): FrequencyWaveformTheme {
	return style.colorScheme === 'dark' ? 'dark' : 'light';
}

/** Log-frequency interpolation retains the established 100–22,050 Hz mapping. */
export function frequencyWaveformPaletteColor(
	frequency: number,
	weight: number,
	sampleRate: number,
	theme: FrequencyWaveformTheme = 'light',
): string {
	if (weight <= FREQUENCY_WAVEFORM_SILENCE_WEIGHT) {
		return theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)';
	}
	if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) throw new RangeError('sampleRate must be positive.');
	const palette = palettes[theme];
	const normalized = (Math.log(Math.max(100, Math.min(22_050, frequency))) - Math.log(100))
		/ (Math.log(22_050) - Math.log(100));
	const position = normalized * (palette.length - 1);
	const left = Math.min(palette.length - 2, Math.floor(position));
	const amount = position - left;
	return `rgb(${palette[left]!.map((channel, index) => (
		Math.round(channel + (palette[left + 1]![index]! - channel) * amount)
	)).join(', ')})`;
}

/** Preserve the spectral hue while making RMS distinct inside the peak body. */
export function frequencyWaveformRmsColor(color: string, theme: FrequencyWaveformTheme): string {
	const channels = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(color);
	if (!channels) return color;
	return `rgb(${channels.slice(1).map((channel) => theme === 'dark'
		? Math.round(Number(channel) + (255 - Number(channel)) * 0.38)
		: Math.round(Number(channel) * 0.72)).join(', ')})`;
}
