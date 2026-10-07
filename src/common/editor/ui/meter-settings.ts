import {
	playbackMeterAmplitudeToDb,
	playbackMeterFullSteps,
	playbackMeterPercent,
} from '../playback-meter.js';

export const METER_POSITIONS = ['flyout', 'top', 'panel'] as const;
export const METER_STYLES = ['default', 'rms', 'gradient'] as const;
export const METER_TYPES = ['db-log', 'db-linear', 'amplitude', 'ebu-r128'] as const;
export const METER_DB_RANGES = [36, 48, 60, 72, 84, 96, 120, 144] as const;
export const EBU_METER_SCALES = ['plus9', 'plus18'] as const;
export const EBU_METER_UNITS = ['absolute', 'relative'] as const;
export const EBU_METER_LIVE_VALUES = ['momentary', 'short-term'] as const;
export const PLAYBACK_METER_SETTINGS_STORAGE_KEY = 'soundscaper-playback-meter-settings-v2';
export const RECORDING_METER_SETTINGS_STORAGE_KEY = 'soundscaper-recording-meter-settings-v2';
const LEGACY_PLAYBACK_METER_SETTINGS_STORAGE_KEY = 'soundscaper-playback-meter-settings-v1';
const LEGACY_RECORDING_METER_SETTINGS_STORAGE_KEY = 'soundscaper-recording-meter-settings-v1';

export interface MeterSettings {
	position: typeof METER_POSITIONS[number];
	style: typeof METER_STYLES[number];
	type: typeof METER_TYPES[number];
	dbRange: typeof METER_DB_RANGES[number];
	ebuScale: typeof EBU_METER_SCALES[number];
	ebuUnit: typeof EBU_METER_UNITS[number];
	ebuLiveValue: typeof EBU_METER_LIVE_VALUES[number];
}

export const DEFAULT_PLAYBACK_METER_SETTINGS: Readonly<MeterSettings> = Object.freeze({
	position: 'panel',
	style: 'default',
	type: 'db-log',
	dbRange: 60,
	ebuScale: 'plus9',
	ebuUnit: 'absolute',
	ebuLiveValue: 'momentary',
});
export const DEFAULT_RECORDING_METER_SETTINGS: Readonly<MeterSettings> = Object.freeze({ ...DEFAULT_PLAYBACK_METER_SETTINGS });

export function playbackMeterTicks(type: MeterSettings['type'], range: number, meterSize: number) {
	return playbackMeterFullSteps(type, range, meterSize).map((step: number) => {
		const db = type === 'amplitude'
			? playbackMeterAmplitudeToDb(step, range)
			: step;
		return {
			label: type === 'amplitude' ? step.toFixed(2) : String(Math.abs(Math.round(step))),
			position: type === 'amplitude'
				? step * 100
				: playbackMeterPercent(db, type, range),
		};
	});
}

export function loadPlaybackMeterSettings(productId = 'soundscaper'): MeterSettings {
	return loadMeterSettings(
		productStorageKey(PLAYBACK_METER_SETTINGS_STORAGE_KEY, productId),
		productId === 'soundscaper' ? LEGACY_PLAYBACK_METER_SETTINGS_STORAGE_KEY : null,
		DEFAULT_PLAYBACK_METER_SETTINGS,
	);
}

export function loadRecordingMeterSettings(productId = 'soundscaper'): MeterSettings {
	return loadMeterSettings(
		productStorageKey(RECORDING_METER_SETTINGS_STORAGE_KEY, productId),
		productId === 'soundscaper' ? LEGACY_RECORDING_METER_SETTINGS_STORAGE_KEY : null,
		DEFAULT_RECORDING_METER_SETTINGS,
	);
}

export function loadMeterSettings(
	storageKey: string,
	legacyStorageKey: string | null,
	defaults: Readonly<MeterSettings>,
): MeterSettings {
	try {
		return normalizeMeterSettings(
			JSON.parse(
				globalThis.localStorage?.getItem(storageKey)
				|| (legacyStorageKey ? globalThis.localStorage?.getItem(legacyStorageKey) : null)
				|| 'null',
			),
			defaults,
		);
	} catch {
		return { ...defaults };
	}
}

export function productStorageKey(soundscaperKey: string, productId: string): string {
	return productId === 'framescaper' ? soundscaperKey.replace(/^soundscaper-/u, 'framescaper-') : soundscaperKey;
}

export function normalizeMeterSettings(value: unknown, defaults: Readonly<MeterSettings>): MeterSettings {
	const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const position = candidate.position === 'side' ? 'panel' : meterChoice(candidate.position, METER_POSITIONS, defaults.position);
	const style = meterChoice(candidate.style, METER_STYLES, defaults.style);
	const type = meterChoice(candidate.type, METER_TYPES, defaults.type);
	const dbRange = meterChoice(Number(candidate.dbRange), METER_DB_RANGES, defaults.dbRange);
	const ebuScale = meterChoice(candidate.ebuScale, EBU_METER_SCALES, defaults.ebuScale);
	const ebuUnit = meterChoice(candidate.ebuUnit, EBU_METER_UNITS, defaults.ebuUnit);
	const ebuLiveValue = meterChoice(candidate.ebuLiveValue, EBU_METER_LIVE_VALUES, defaults.ebuLiveValue);
	return { position, style, type, dbRange, ebuScale, ebuUnit, ebuLiveValue };
}

function meterChoice<Value>(value: unknown, choices: readonly Value[], fallback: Value): Value {
	return choices.includes(value as Value) ? value as Value : fallback;
}

export function formatDb(value: number): string {
	if (!Number.isFinite(value) || value <= -60) return '−∞ dB';
	const rounded = Math.round(value * 10) / 10;
	return `${String(rounded).replace('-', '−')} dB`;
}

export function formatEbuLoudness(value: number | null | undefined, unit: MeterSettings['ebuUnit'] = 'absolute'): string {
	const suffix = unit === 'relative' ? 'LU' : 'LUFS';
	const displayed = typeof value === 'number' && unit === 'relative' ? value + 23 : value;
	return formatMeterNumber(displayed, suffix);
}

export function formatLra(value: number | null | undefined): string {
	return formatMeterNumber(value, 'LU');
}

export function formatDbtp(value: number | null | undefined): string {
	return formatMeterNumber(value, 'dBTP');
}

function formatMeterNumber(value: number | null | undefined, suffix: string): string {
	return typeof value === 'number' && Number.isFinite(value)
		? `${String(value.toFixed(1)).replace('-', '−')} ${suffix}`
		: `— ${suffix}`;
}

export function formatPlaybackSpeed(rate: number): string {
	return Number(rate).toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
}
