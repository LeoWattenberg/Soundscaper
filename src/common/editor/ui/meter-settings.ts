import {
	playbackMeterAmplitudeToDb,
	playbackMeterFullSteps,
	playbackMeterPercent,
} from '../playback-meter.js';

export const METER_POSITIONS = ['flyout', 'top', 'side'] as const;
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
	position: 'side',
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
	const position = METER_POSITIONS.includes(candidate.position as MeterSettings['position'])
		? candidate.position as MeterSettings['position']
		: defaults.position;
	const style = METER_STYLES.includes(candidate.style as MeterSettings['style'])
		? candidate.style as MeterSettings['style']
		: defaults.style;
	const type = METER_TYPES.includes(candidate.type as MeterSettings['type'])
		? candidate.type as MeterSettings['type']
		: defaults.type;
	const dbRangeCandidate = Number(candidate.dbRange);
	const dbRange = METER_DB_RANGES.includes(dbRangeCandidate as MeterSettings['dbRange'])
		? dbRangeCandidate as MeterSettings['dbRange']
		: defaults.dbRange;
	const ebuScale = EBU_METER_SCALES.includes(candidate.ebuScale as MeterSettings['ebuScale'])
		? candidate.ebuScale as MeterSettings['ebuScale']
		: defaults.ebuScale;
	const ebuUnit = EBU_METER_UNITS.includes(candidate.ebuUnit as MeterSettings['ebuUnit'])
		? candidate.ebuUnit as MeterSettings['ebuUnit']
		: defaults.ebuUnit;
	const ebuLiveValue = EBU_METER_LIVE_VALUES.includes(candidate.ebuLiveValue as MeterSettings['ebuLiveValue'])
		? candidate.ebuLiveValue as MeterSettings['ebuLiveValue']
		: defaults.ebuLiveValue;
	return { position, style, type, dbRange, ebuScale, ebuUnit, ebuLiveValue };
}

export function formatDb(value: number): string {
	if (!Number.isFinite(value) || value <= -60) return '−∞ dB';
	const rounded = Math.round(value * 10) / 10;
	return `${String(rounded).replace('-', '−')} dB`;
}

export function formatEbuLoudness(value: number | null | undefined, unit: MeterSettings['ebuUnit'] = 'absolute'): string {
	const suffix = unit === 'relative' ? 'LU' : 'LUFS';
	if (typeof value !== 'number' || !Number.isFinite(value)) return `— ${suffix}`;
	const displayed = unit === 'relative' ? value + 23 : value;
	return `${String(displayed.toFixed(1)).replace('-', '−')} ${suffix}`;
}

export function formatLra(value: number | null | undefined): string {
	return typeof value === 'number' && Number.isFinite(value)
		? `${String(value.toFixed(1)).replace('-', '−')} LU`
		: '— LU';
}

export function formatDbtp(value: number | null | undefined): string {
	return typeof value === 'number' && Number.isFinite(value)
		? `${String(value.toFixed(1)).replace('-', '−')} dBTP`
		: '— dBTP';
}

export function formatPlaybackSpeed(rate: number): string {
	return Number(rate).toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
}
