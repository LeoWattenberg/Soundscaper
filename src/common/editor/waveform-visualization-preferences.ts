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

const WAVEFORM_VISUALIZATION_PREFERENCE_FIELDS = Object.freeze([
	'lowMidCrossoverHz',
	'midHighCrossoverHz',
] as const);

type WaveformVisualizationPreferenceField =
	(typeof WAVEFORM_VISUALIZATION_PREFERENCE_FIELDS)[number];

export function normalizeWaveformVisualizationPreferences(
	value: unknown = DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES,
): WaveformVisualizationPreferences {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('waveformVisualization must be a plain data object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('waveformVisualization must be a plain data object.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string'
		|| !WAVEFORM_VISUALIZATION_PREFERENCE_FIELDS.includes(
			key as WaveformVisualizationPreferenceField,
		))) {
		throw new TypeError('waveformVisualization contains an unsupported field.');
	}
	const input = value as Readonly<Record<string, unknown>>;
	const lowMidValue = preferenceDataValue(input, 'lowMidCrossoverHz');
	const midHighValue = preferenceDataValue(input, 'midHighCrossoverHz');
	const lowMidCrossoverHz = crossoverFrequency(
		lowMidValue === undefined
			? DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES.lowMidCrossoverHz
			: lowMidValue,
		'waveformVisualization.lowMidCrossoverHz',
	);
	const midHighCrossoverHz = crossoverFrequency(
		midHighValue === undefined
			? DEFAULT_WAVEFORM_VISUALIZATION_PREFERENCES.midHighCrossoverHz
			: midHighValue,
		'waveformVisualization.midHighCrossoverHz',
	);
	if (lowMidCrossoverHz >= midHighCrossoverHz) {
		throw new RangeError('Waveform visualization crossover frequencies must be strictly increasing.');
	}
	return Object.freeze({ lowMidCrossoverHz, midHighCrossoverHz });
}

function crossoverFrequency(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)
		|| value < WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ
		|| value > WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ) {
		throw new RangeError(
			`${name} must be an integer between ${WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ} and ${WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ}.`,
		);
	}
	return value;
}

function preferenceDataValue(
	record: Readonly<Record<string, unknown>>,
	field: WaveformVisualizationPreferenceField,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`waveformVisualization.${field} must be an enumerable data property.`);
	}
	return descriptor.value;
}
