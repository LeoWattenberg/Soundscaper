/* SPDX-License-Identifier: AGPL-3.0-only */

export type WaveformRulerFormat = 'linear-db' | 'linear-amp' | 'logarithmic-db';

export interface WaveformDisplayPreferences {
	readonly rulerFormat: WaveformRulerFormat;
	readonly halfWave: boolean;
}

export const DEFAULT_WAVEFORM_DISPLAY_PREFERENCES: Readonly<WaveformDisplayPreferences> = Object.freeze({
	rulerFormat: 'linear-db',
	halfWave: false,
});

const PREFERENCE_FIELDS = Object.freeze(['rulerFormat', 'halfWave'] as const);
type PreferenceField = (typeof PREFERENCE_FIELDS)[number];

/** Global waveform defaults remain beneath each track's explicit display choices. */
export function normalizeWaveformDisplayPreferences(
	value: unknown = DEFAULT_WAVEFORM_DISPLAY_PREFERENCES,
): WaveformDisplayPreferences {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('waveformDisplay must be a plain data object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('waveformDisplay must be a plain data object.');
	}
	if (Reflect.ownKeys(value).some((key) => typeof key !== 'string'
		|| !PREFERENCE_FIELDS.includes(key as PreferenceField))) {
		throw new TypeError('waveformDisplay contains an unsupported field.');
	}
	const input = value as Readonly<Record<string, unknown>>;
	const formatValue = preferenceDataValue(input, 'rulerFormat');
	const rulerFormat = formatValue === undefined
		? DEFAULT_WAVEFORM_DISPLAY_PREFERENCES.rulerFormat : formatValue;
	if (rulerFormat !== 'linear-db' && rulerFormat !== 'linear-amp' && rulerFormat !== 'logarithmic-db') {
		throw new RangeError('waveformDisplay.rulerFormat must be linear-db, linear-amp or logarithmic-db.');
	}
	const halfWaveValue = preferenceDataValue(input, 'halfWave');
	const halfWave = halfWaveValue === undefined
		? DEFAULT_WAVEFORM_DISPLAY_PREFERENCES.halfWave : halfWaveValue;
	if (typeof halfWave !== 'boolean') {
		throw new TypeError('waveformDisplay.halfWave must be boolean.');
	}
	return Object.freeze({ rulerFormat, halfWave });
}

function preferenceDataValue(
	record: Readonly<Record<string, unknown>>,
	field: PreferenceField,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`waveformDisplay.${field} must be an enumerable data property.`);
	}
	return descriptor.value;
}
