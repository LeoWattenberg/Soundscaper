import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_EFFECT_FACTORY_PRESETS,
	AUDACITY_FACTORY_PRESET_SOURCE,
	audacityFactoryPreset,
	audacityFactoryPresets,
	isAudacityFactoryPresetId,
} from '../src/common/editor/audacity-effects/factory-presets.js';
import {
	AUDACITY_EQUALIZATION_FACTORY_PRESET_CURVES,
} from '../src/common/editor/audacity-effects/factory-preset-tables.js';
import {
	audacityEffectDefaults,
	normalizeAudacityEffectParams,
} from '../src/common/editor/audacity-effects/manifest.js';
import { canonicalCopyValue } from '../src/common/i18n/canonical-extras.js';

const byName = (effectType, name) => audacityFactoryPresets(effectType).find((preset) => preset.name === name);

test('every shipped effect preset is complete, identified and named', () => {
	assert.equal(AUDACITY_FACTORY_PRESET_SOURCE.version, '4.0.0');
	assert.deepEqual(
		Object.fromEntries(Object.entries(AUDACITY_EFFECT_FACTORY_PRESETS)
			.map(([effectType, presets]) => [effectType, presets.length])),
		{
			'audacity-compressor': 27,
			'audacity-distortion': 20,
			'audacity-filter-curve-eq': 10,
			'audacity-graphic-eq': 5,
			'audacity-limiter': 7,
			'audacity-reverb': 18,
		},
	);

	const presets = audacityFactoryPresets();
	assert.equal(new Set(presets.map(({ id }) => id)).size, presets.length);
	for (const preset of presets) {
		assert.equal(preset.custom, false);
		assert.ok(isAudacityFactoryPresetId(preset.id), `${preset.id} should be namespaced`);
		assert.equal(audacityFactoryPreset(preset.id), preset);
		// A preset must set every parameter of its effect, so applying one never
		// leaves a control on whatever the previous preset happened to put there.
		assert.deepEqual(
			Object.keys(preset.params).sort(),
			Object.keys(audacityEffectDefaults(preset.effectType)).sort(),
		);
		assert.deepEqual(normalizeAudacityEffectParams(preset.effectType, preset.params), preset.params);
		for (const locale of ['en', 'de']) {
			assert.notEqual(canonicalCopyValue(preset.labelKey, locale), preset.labelKey,
				`${preset.labelKey} has no ${locale} name`);
		}
	}
	assert.equal(audacityFactoryPreset('audacity-factory:audacity-reverb:nothing'), null);
	assert.deepEqual(audacityFactoryPresets('audacity-amplify'), []);
	assert.equal(isAudacityFactoryPresetId('preset-speech'), false);
});

test('reverb presets keep the character upstream gives them', () => {
	assert.deepEqual(byName('audacity-reverb', 'Vocal I').params, {
		roomSize: 70,
		preDelay: 20,
		reverberance: 40,
		damping: 99,
		toneLow: 100,
		toneHigh: 50,
		wetGainDb: -12,
		dryGainDb: 0,
		stereoWidth: 70,
		wetOnly: false,
	});
	// These two differ in nothing but the wet tone balance, so a reverb without
	// tone controls would offer the same preset twice under two names.
	const bright = byName('audacity-reverb', 'Small Room Bright').params;
	const dark = byName('audacity-reverb', 'Small Room Dark').params;
	assert.notDeepEqual(bright, dark);
	assert.deepEqual(
		[bright.toneLow, bright.toneHigh, dark.toneLow, dark.toneHigh],
		[50, 100, 100, 0],
	);
});

test('distortion presets select the mode their upstream table index names', () => {
	assert.deepEqual(byName('audacity-distortion', 'Fuzz Box').params, {
		mode: 'soft-clipping',
		dcBlock: false,
		thresholdDb: -30,
		noiseFloorDb: -70,
		parameter1: 80,
		parameter2: 80,
		repeats: 0,
	});
	assert.equal(byName('audacity-distortion', 'Valve Overdrive').params.dcBlock, true);
	assert.equal(byName('audacity-distortion', 'Percussion Limiter').params.mode, 'hard-limiter');
	assert.deepEqual(
		audacityFactoryPresets('audacity-distortion')
			.filter((preset) => preset.name.startsWith('Leveller'))
			.map((preset) => preset.params.repeats),
		[1, 2, 3, 4, 5],
	);
});

test('dynamics presets carry the processing settings and drop the meter flags', () => {
	assert.deepEqual(byName('audacity-compressor', 'Modern').params, {
		thresholdDb: -14,
		makeupGainDb: 0,
		kneeWidthDb: 18,
		ratio: 4,
		lookaheadMs: 1,
		attackMs: 0.2,
		releaseMs: 210,
	});
	assert.deepEqual(byName('audacity-limiter', 'Master Limiter').params, {
		thresholdDb: -0.1,
		makeupTargetDb: -0.1,
		kneeWidthDb: 0.1,
		lookaheadMs: 0.1,
		releaseMs: 0.1,
	});
	assert.equal(byName('audacity-compressor', 'Brick Wall Master').params.ratio, 100);
});

test('equalization curves are truncated at the editor Nyquist frequency', () => {
	const amRadio = byName('audacity-filter-curve-eq', 'AM Radio').params.points;
	const upstream = AUDACITY_EQUALIZATION_FACTORY_PRESET_CURVES
		.find((curve) => curve.name === 'AM Radio').points;
	assert.ok(upstream.some(([frequency]) => frequency > 24_000));
	assert.equal(amRadio.at(-1).frequency, 24_000);
	// Linear in decibels over a logarithmic frequency axis, between the 20 kHz
	// and 48 kHz points upstream draws through.
	const amount = (Math.log10(24_000) - Math.log10(20_000)) / (Math.log10(48_000) - Math.log10(20_000));
	assert.ok(Math.abs(amRadio.at(-1).gain - (-103.651 + amount * (-164.485 + 103.651))) < 1e-9);
	assert.deepEqual(amRadio.slice(0, -1), upstream.slice(0, -1).map(([frequency, gain]) => ({ frequency, gain })));

	const riaa = byName('audacity-filter-curve-eq', 'RIAA').params.points;
	assert.equal(riaa.length, 32);
	assert.equal(riaa.at(-1).frequency, 24_000);
	// Curves that stay inside the range are carried across untouched.
	assert.deepEqual(byName('audacity-filter-curve-eq', 'Bass Cut').params.points, [
		{ frequency: 150, gain: -50 },
		{ frequency: 300, gain: 0 },
	]);
});

test('graphic EQ offers the curves upstream shares, read onto its sliders', () => {
	assert.deepEqual(
		audacityFactoryPresets('audacity-graphic-eq').map(({ name }) => name),
		['Bass Boost', 'Bass Cut', 'RIAA', 'Treble Boost', 'Treble Cut'],
	);
	const bassBoost = byName('audacity-graphic-eq', 'Bass Boost').params.gains;
	assert.equal(bassBoost.length, 31);
	assert.equal(bassBoost[0], 9, '20 Hz sits below the curve, which holds its first value');
	assert.equal(bassBoost.at(-1), 0, '20 kHz sits above the curve, which holds its last value');
	// A curve that leaves the slider range is clipped to it, and every band
	// lands on the half-decibel step the slider can represent.
	const bassCut = byName('audacity-graphic-eq', 'Bass Cut').params.gains;
	assert.equal(Math.min(...bassCut), -20);
	for (const gain of [...bassCut, ...byName('audacity-graphic-eq', 'RIAA').params.gains]) {
		assert.equal(gain * 2, Math.round(gain * 2), `${gain} is not a half-decibel step`);
	}
});
