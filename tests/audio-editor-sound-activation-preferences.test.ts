/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import {
	DEFAULT_SOUND_ACTIVATION_PREFERENCES,
	normalizeSoundActivationPreferences,
	soundActivationSettingsFromPreferences,
} from '../src/common/editor/sound-activation-preferences.ts';

const ENABLED_PREFERENCES = Object.freeze({
	enabled: true,
	thresholdDb: -40,
	hysteresisDb: 6,
	holdMilliseconds: 250,
});

test('sound activation preferences expose immutable canonical defaults', () => {
	assert.deepEqual(DEFAULT_SOUND_ACTIVATION_PREFERENCES, {
		enabled: false,
		thresholdDb: -40,
		hysteresisDb: 6,
		holdMilliseconds: 250,
	});
	assert.equal(Object.isFrozen(DEFAULT_SOUND_ACTIVATION_PREFERENCES), true);
	assert.throws(() => {
		(DEFAULT_SOUND_ACTIVATION_PREFERENCES as unknown as { enabled: boolean }).enabled = true;
	}, TypeError);

	const normalized = normalizeSoundActivationPreferences(ENABLED_PREFERENCES);
	assert.deepEqual(normalized, ENABLED_PREFERENCES);
	assert.notEqual(normalized, ENABLED_PREFERENCES);
	assert.equal(Object.isFrozen(normalized), true);
	assert.throws(() => {
		(normalized as unknown as { thresholdDb: number }).thresholdDb = -20;
	}, TypeError);
});

test('sound activation preference normalization accepts only a closed plain-data record', () => {
	const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, ENABLED_PREFERENCES);
	assert.deepEqual(normalizeSoundActivationPreferences(nullPrototype), ENABLED_PREFERENCES);

	const inherited = Object.assign(Object.create({ inherited: true }) as Record<string, unknown>, ENABLED_PREFERENCES);
	const symbolField = { ...ENABLED_PREFERENCES, [Symbol('field')]: true };
	const unknownField = { ...ENABLED_PREFERENCES, future: true };
	const missingField = { enabled: true, thresholdDb: -40, hysteresisDb: 6 };
	for (const value of [null, [], new Date(), inherited, symbolField, unknownField, missingField]) {
		assert.throws(() => normalizeSoundActivationPreferences(value), /sound activation preferences/i);
	}

	let getterCalls = 0;
	const accessor = { ...ENABLED_PREFERENCES } as Record<string, unknown>;
	Object.defineProperty(accessor, 'thresholdDb', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return -40;
		},
	});
	assert.throws(() => normalizeSoundActivationPreferences(accessor), /thresholdDb/i);
	assert.equal(getterCalls, 0);

	const nonEnumerable = { ...ENABLED_PREFERENCES };
	Object.defineProperty(nonEnumerable, 'thresholdDb', { enumerable: false, value: -40 });
	assert.throws(() => normalizeSoundActivationPreferences(nonEnumerable), /thresholdDb/i);
});

test('sound activation preference fields are strictly typed, bounded, and canonical', () => {
	assert.deepEqual(normalizeSoundActivationPreferences({
		enabled: false,
		thresholdDb: -100,
		hysteresisDb: 0,
		holdMilliseconds: 0,
	}), { enabled: false, thresholdDb: -100, hysteresisDb: 0, holdMilliseconds: 0 });
	assert.deepEqual(normalizeSoundActivationPreferences({
		enabled: true,
		thresholdDb: 0,
		hysteresisDb: 24,
		holdMilliseconds: 600_000,
	}), { enabled: true, thresholdDb: 0, hysteresisDb: 24, holdMilliseconds: 600_000 });

	const invalid = [
		{ ...ENABLED_PREFERENCES, enabled: 1 },
		{ ...ENABLED_PREFERENCES, thresholdDb: NaN },
		{ ...ENABLED_PREFERENCES, thresholdDb: Number.NEGATIVE_INFINITY },
		{ ...ENABLED_PREFERENCES, thresholdDb: -101 },
		{ ...ENABLED_PREFERENCES, thresholdDb: 1 },
		{ ...ENABLED_PREFERENCES, thresholdDb: -0 },
		{ ...ENABLED_PREFERENCES, hysteresisDb: NaN },
		{ ...ENABLED_PREFERENCES, hysteresisDb: -1 },
		{ ...ENABLED_PREFERENCES, hysteresisDb: 25 },
		{ ...ENABLED_PREFERENCES, hysteresisDb: -0 },
		{ ...ENABLED_PREFERENCES, holdMilliseconds: NaN },
		{ ...ENABLED_PREFERENCES, holdMilliseconds: -1 },
		{ ...ENABLED_PREFERENCES, holdMilliseconds: 600_001 },
		{ ...ENABLED_PREFERENCES, holdMilliseconds: 1.5 },
		{ ...ENABLED_PREFERENCES, holdMilliseconds: -0 },
	];
	for (const value of invalid) {
		assert.throws(() => normalizeSoundActivationPreferences(value), /sound activation/i);
	}
});

test('V1 preferences default an omitted nested sound activation record but reject a present invalid value', () => {
	const preferences = createAudioEditorPreferencesV1();
	assert.deepEqual(preferences.recording.soundActivation, DEFAULT_SOUND_ACTIVATION_PREFERENCES);
	assert.equal(Object.isFrozen(preferences.recording.soundActivation), true);

	const oldV1 = structuredClone(preferences);
	delete (oldV1.recording as { soundActivation?: unknown }).soundActivation;
	assert.equal(validateAudioEditorPreferencesV1(oldV1), true);
	const loaded = loadAudioEditorPreferencesV1(oldV1);
	assert.deepEqual(loaded.preferences.recording.soundActivation, DEFAULT_SOUND_ACTIVATION_PREFERENCES);
	assert.equal(Object.isFrozen(loaded.preferences.recording.soundActivation), true);

	assert.throws(() => createAudioEditorPreferencesV1({
		recording: { retainInputs: true, soundActivation: undefined },
	}), /sound activation preferences/i);
	assert.throws(() => validateAudioEditorPreferencesV1({
		...preferences,
		recording: { ...preferences.recording, soundActivation: null },
	}), /sound activation preferences/i);

	let getterCalls = 0;
	const recording = { retainInputs: true } as Record<string, unknown>;
	Object.defineProperty(recording, 'soundActivation', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return ENABLED_PREFERENCES;
		},
	});
	assert.throws(() => createAudioEditorPreferencesV1({ recording }), /soundActivation/i);
	assert.equal(getterCalls, 0);
});

test('V1 sound activation preferences survive strict update and load round trips', () => {
	const defaults = createAudioEditorPreferencesV1();
	const updated = updateAudioEditorPreferencesV1(defaults, {
		recording: {
			soundActivation: {
				enabled: true,
				thresholdDb: -24.5,
				hysteresisDb: 3.5,
				holdMilliseconds: 375,
			},
		},
	});
	assert.deepEqual(updated.recording, {
		retainInputs: true,
		soundActivation: {
			enabled: true,
			thresholdDb: -24.5,
			hysteresisDb: 3.5,
			holdMilliseconds: 375,
		},
	});
	const loaded = loadAudioEditorPreferencesV1(structuredClone(updated));
	assert.deepEqual(loaded.preferences.recording, updated.recording);
	assert.equal(Object.isFrozen(loaded.preferences.recording.soundActivation), true);
});

test('sound activation preferences convert milliseconds to bounded runtime frames with exact rounding', () => {
	assert.equal(soundActivationSettingsFromPreferences(DEFAULT_SOUND_ACTIVATION_PREFERENCES, 48_000), null);
	for (const [sampleRate, holdFrames] of [
		[8_000, 2_000],
		[44_100, 11_025],
		[48_000, 12_000],
		[384_000, 96_000],
	] as const) {
		const settings = soundActivationSettingsFromPreferences(ENABLED_PREFERENCES, sampleRate);
		assert.deepEqual(settings, { thresholdDb: -40, hysteresisDb: 6, holdFrames });
		assert.equal(Object.isFrozen(settings), true);
	}
	assert.equal(soundActivationSettingsFromPreferences({
		...ENABLED_PREFERENCES,
		holdMilliseconds: 15,
	}, 44_100)?.holdFrames, 662);
	assert.equal(soundActivationSettingsFromPreferences({
		...ENABLED_PREFERENCES,
		holdMilliseconds: 600_000,
	}, 384_000)?.holdFrames, 230_400_000);

	for (const sampleRate of [0, -0, -1, 44_100.5, 384_001, NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() => soundActivationSettingsFromPreferences(ENABLED_PREFERENCES, sampleRate),
			/sound activation sample rate/i,
		);
	}
});
