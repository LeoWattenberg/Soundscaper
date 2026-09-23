/* SPDX-License-Identifier: AGPL-3.0-only */

export const WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ = 20;
export const WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ = 20_000;

export interface WaveformVisualizationPreferences {
	readonly lowMidCrossoverHz: number;
	readonly midHighCrossoverHz: number;
}

export const DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES: Readonly<WaveformVisualizationPreferences> =
	Object.freeze({
		lowMidCrossoverHz: 250,
		midHighCrossoverHz: 4_000,
	});

export function normalizeWaveformVisualizationPreferences(
	value: unknown = DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES,
): WaveformVisualizationPreferences {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('waveformVisualization must be an object.');
	}
	const input = value as Partial<Record<keyof WaveformVisualizationPreferences, unknown>>;
	const lowMidCrossoverHz = crossoverFrequency(
		input.lowMidCrossoverHz === undefined
			? DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES.lowMidCrossoverHz
			: input.lowMidCrossoverHz,
		'waveformVisualization.lowMidCrossoverHz',
	);
	const midHighCrossoverHz = crossoverFrequency(
		input.midHighCrossoverHz === undefined
			? DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES.midHighCrossoverHz
			: input.midHighCrossoverHz,
		'waveformVisualization.midHighCrossoverHz',
	);
	if (lowMidCrossoverHz >= midHighCrossoverHz) {
		throw new RangeError('Waveform visualization crossover frequencies must be strictly increasing.');
	}
	return { lowMidCrossoverHz, midHighCrossoverHz };
}

function crossoverFrequency(value: unknown, name: string): number {
	const frequency = Number(value);
	if (!Number.isSafeInteger(frequency)
		|| frequency < WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ
		|| frequency > WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ) {
		throw new RangeError(
			`${name} must be an integer between ${WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ} and ${WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ}.`,
		);
	}
	return frequency;
}
