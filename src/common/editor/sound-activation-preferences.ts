/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeSoundActivationSettings,
	SOUND_ACTIVATION_LIMITS,
	type SoundActivationSettings,
} from './controller/sound-activated-recording-gate.ts';

export interface SoundActivationPreferences {
	readonly enabled: boolean;
	readonly thresholdDb: number;
	readonly hysteresisDb: number;
	readonly holdMilliseconds: number;
}

export const SOUND_ACTIVATION_PREFERENCE_LIMITS = Object.freeze({
	minimumThresholdDb: SOUND_ACTIVATION_LIMITS.minimumThresholdDb,
	maximumThresholdDb: SOUND_ACTIVATION_LIMITS.maximumThresholdDb,
	maximumHysteresisDb: SOUND_ACTIVATION_LIMITS.maximumHysteresisDb,
	maximumHoldMilliseconds: 600_000,
	maximumSampleRate: 384_000,
});

export const DEFAULT_SOUND_ACTIVATION_PREFERENCES: SoundActivationPreferences = Object.freeze({
	enabled: false,
	thresholdDb: -40,
	hysteresisDb: 6,
	holdMilliseconds: 250,
});

const PREFERENCE_KEYS = Object.freeze([
	'enabled',
	'thresholdDb',
	'hysteresisDb',
	'holdMilliseconds',
] as const);

type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export function normalizeSoundActivationPreferences(value: unknown): SoundActivationPreferences {
	const input = closedPreferenceRecord(value);
	if (typeof input.enabled !== 'boolean') {
		throw new TypeError('The sound activation preferences enabled field is invalid.');
	}
	const thresholdDb = boundedCanonicalNumber(
		input.thresholdDb,
		SOUND_ACTIVATION_PREFERENCE_LIMITS.minimumThresholdDb,
		SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumThresholdDb,
		'thresholdDb',
	);
	const hysteresisDb = boundedCanonicalNumber(
		input.hysteresisDb,
		0,
		SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumHysteresisDb,
		'hysteresisDb',
	);
	const holdMilliseconds = boundedCanonicalNumber(
		input.holdMilliseconds,
		0,
		SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumHoldMilliseconds,
		'holdMilliseconds',
	);
	if (!Number.isSafeInteger(holdMilliseconds)) {
		throw new RangeError('The sound activation preferences holdMilliseconds field is invalid.');
	}
	return Object.freeze({
		enabled: input.enabled,
		thresholdDb,
		hysteresisDb,
		holdMilliseconds,
	});
}

export function soundActivationSettingsFromPreferences(
	value: unknown,
	sampleRateValue: unknown,
): SoundActivationSettings | null {
	const preferences = normalizeSoundActivationPreferences(value);
	if (!Number.isSafeInteger(sampleRateValue)
		|| Object.is(sampleRateValue, -0)
		|| Number(sampleRateValue) <= 0
		|| Number(sampleRateValue) > SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumSampleRate) {
		throw new RangeError('The sound activation sample rate is invalid.');
	}
	if (!preferences.enabled) return null;
	const sampleRate = Number(sampleRateValue);
	return normalizeSoundActivationSettings({
		thresholdDb: preferences.thresholdDb,
		hysteresisDb: preferences.hysteresisDb,
		holdFrames: Math.round((preferences.holdMilliseconds * sampleRate) / 1_000),
	});
}

function closedPreferenceRecord(value: unknown): Record<PreferenceKey, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('The sound activation preferences must be a plain data record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('The sound activation preferences must be a plain data record.');
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== PREFERENCE_KEYS.length || keys.some((key) => (
		typeof key !== 'string' || !PREFERENCE_KEYS.includes(key as PreferenceKey)
	))) {
		throw new TypeError('The sound activation preferences contain an unknown or missing field.');
	}
	const snapshot = Object.create(null) as Record<PreferenceKey, unknown>;
	for (const key of PREFERENCE_KEYS) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) {
			throw new TypeError(`The sound activation preferences ${key} field must be enumerable data.`);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function boundedCanonicalNumber(
	value: unknown,
	minimum: number,
	maximum: number,
	field: PreferenceKey,
): number {
	if (typeof value !== 'number'
		|| !Number.isFinite(value)
		|| Object.is(value, -0)
		|| value < minimum
		|| value > maximum) {
		throw new RangeError(`The sound activation preferences ${field} field is invalid.`);
	}
	return value;
}
