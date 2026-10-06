/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy the painter's palette while all canvases are still in the read phase. */
export function snapshotWaveformCanvasStyle(
	style: Pick<CSSStyleDeclaration, 'colorScheme' | 'getPropertyValue'>,
	color: string,
): Pick<CSSStyleDeclaration, 'colorScheme' | 'getPropertyValue'> {
	const properties = [
		`--clip-${color}-waveform`, `--clip-${color}-time-selection-waveform`,
		`--clip-${color}-waveform-rms`, `--clip-${color}-time-selection-waveform-rms`,
		`--clip-${color}-divider`, `--clip-${color}-time-selection-body`,
		'--frequency-sample', '--frequency-selected-sample', '--frequency-rms',
		'--frequency-divider', '--frequency-selection-body', '--frequency-low',
		'--frequency-mid', '--frequency-high', '--frequency-rms-overlay',
		'--split-separator', '--spectrogram-background',
	];
	const values = new Map(properties.map((property) => [property, style.getPropertyValue(property)]));
	return { colorScheme: style.colorScheme, getPropertyValue: (property) => values.get(property) || '' };
}
