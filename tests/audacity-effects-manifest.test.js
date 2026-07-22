import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDACITY_EFFECT_DEFINITIONS,
	AUDACITY_EFFECT_EXCLUSIONS,
	AUDACITY_NON_PROCESS_MODULES,
	AUDACITY_EFFECT_SOURCE,
	AUDACITY_STAFFPAD_SOURCE,
	AUDACITY_EFFECT_UPSTREAM_FILES,
	audacityEffectDefaults,
	audacityEffectLabel,
	audacityEffectOptionLabel,
	audacityEffectParameterLabel,
	audacityEffectTypes,
	formatAudacityCurve,
	normalizeAudacityEffectParams,
	parseAudacityCurve,
} from '../src/common/editor/audacity-effects/manifest.js';

const INCLUDED_EFFECTS = [
	'audacity-amplify',
	'audacity-auto-duck',
	'audacity-bass-treble',
	'audacity-click-removal',
	'audacity-change-pitch',
	'audacity-change-tempo',
	'audacity-change-speed-pitch',
	'audacity-sliding-stretch',
	'audacity-compressor',
	'audacity-legacy-compressor',
	'audacity-distortion',
	'audacity-echo',
	'audacity-fade-in',
	'audacity-fade-out',
	'audacity-filter-curve-eq',
	'audacity-graphic-eq',
	'audacity-invert',
	'audacity-limiter',
	'audacity-loudness-normalization',
	'audacity-noise-reduction',
	'audacity-normalize',
	'audacity-paulstretch',
	'audacity-phaser',
	'audacity-repair',
	'audacity-remove-dc-offset',
	'audacity-reverb',
	'audacity-repeat',
	'audacity-reverse',
	'audacity-classic-filters',
	'audacity-truncate-silence',
	'audacity-wahwah',
];

test('Audacity manifest pins the legacy inventory and current StaffPad processing effects', () => {
	assert.equal(AUDACITY_EFFECT_SOURCE.version, '3.7.7');
	assert.equal(AUDACITY_EFFECT_SOURCE.commit, '5ef610ed23260d6d648175735bb16b32536eb30b');
	assert.equal(AUDACITY_STAFFPAD_SOURCE.commit, '908ad0a526e5bfdab68de780e893cebe172d27eb');
	assert.deepEqual(audacityEffectTypes(), INCLUDED_EFFECTS);
	assert.equal(Object.keys(AUDACITY_EFFECT_DEFINITIONS).length, 31);
	assert.deepEqual(Object.keys(AUDACITY_EFFECT_UPSTREAM_FILES), INCLUDED_EFFECTS);
	assert.ok(Object.values(AUDACITY_EFFECT_UPSTREAM_FILES).every((paths) => paths.length > 0 && paths.every((path) => path.endsWith('.cpp'))));
	assert.ok(Object.isFrozen(AUDACITY_EFFECT_DEFINITIONS));
	assert.ok(Object.isFrozen(AUDACITY_EFFECT_DEFINITIONS['audacity-distortion'].params.mode.options));
});

test('native modules which are not menu-visible processing effects stay explicit', () => {
	assert.deepEqual(AUDACITY_NON_PROCESS_MODULES, {
		DTMF: 'generate',
		Chirp: 'generate',
		Noise: 'generate',
		Silence: 'generate',
		Tone: 'generate',
		'Find Clipping': 'analyze',
		'Stereo To Mono': 'hidden',
	});
	assert.ok(Object.isFrozen(AUDACITY_NON_PROCESS_MODULES));
});

test('browser Reverb avoids SoX while StaffPad replaces SoundTouch and SBSMS effects', () => {
	assert.deepEqual(AUDACITY_EFFECT_EXCLUSIONS, []);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-reverb'].browserAdaptation, 'schroeder');
	assert.equal(audacityEffectTypes().includes('audacity-remove-dc-offset'), true);
	for (const type of ['audacity-change-pitch', 'audacity-change-tempo', 'audacity-change-speed-pitch', 'audacity-sliding-stretch']) {
		assert.equal(AUDACITY_EFFECT_DEFINITIONS[type].requiresStaffPad, true);
		assert.match(AUDACITY_EFFECT_UPSTREAM_FILES[type].join(' '), /StaffPad\/TimeAndPitch\.cpp/);
	}
	assert.doesNotMatch(JSON.stringify(AUDACITY_EFFECT_UPSTREAM_FILES), /SoundTouch|SBSMSBase/);
});

test('Audacity labels suffix only collisions and provide German names', () => {
	assert.equal(audacityEffectLabel('audacity-compressor'), 'Compressor (Audacity)');
	assert.equal(audacityEffectLabel('audacity-limiter'), 'Limiter (Audacity)');
	assert.equal(audacityEffectLabel('audacity-compressor', 'de'), 'Kompressor (Audacity)');
	assert.equal(audacityEffectLabel('audacity-bass-treble', 'de'), 'Bass und Höhen');
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-compressor'].collision, true);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-limiter'].collision, true);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-reverse'].collision, undefined);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-compressor'].label, undefined);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-compressor'].labelKey, 'effectNameAudacityCompressor');
	assert.equal(audacityEffectLabel('audacity-compressor', { effectNameAudacityCompressor: 'Remote compressor' }), 'Remote compressor');
	assert.equal(audacityEffectParameterLabel('audacity-distortion', 'mode', {
		effectParamAudacityDistortionMode: 'Remote mode',
	}), 'Remote mode');
	assert.equal(audacityEffectOptionLabel('audacity-distortion', 'mode', 'soft-clipping', {
		effectOptionAudacityDistortionModeSoftClipping: 'Remote soft clipping',
	}), 'Remote soft clipping');
});

test('Audacity defaults and parameter normalization retain enum, boolean, curve, and band types', () => {
	const distortion = normalizeAudacityEffectParams('audacity-distortion', {
		...audacityEffectDefaults('audacity-distortion'),
		mode: 'rectifier',
		dcBlock: 'true',
		repeats: 2.4,
	});
	assert.equal(distortion.mode, 'rectifier');
	assert.equal(distortion.dcBlock, true);
	assert.equal(distortion.repeats, 2);

	const curve = parseAudacityCurve('20000:-6, 20:0, 1000 3');
	assert.deepEqual(curve, [
		{ frequency: 20, gain: 0 },
		{ frequency: 1_000, gain: 3 },
		{ frequency: 20_000, gain: -6 },
	]);
	assert.equal(formatAudacityCurve(curve), '20:0, 1000:3, 20000:-6');
	assert.equal(normalizeAudacityEffectParams('audacity-graphic-eq').gains.length, 31);
	assert.equal(normalizeAudacityEffectParams('audacity-filter-curve-eq').linearFrequencyScale, false);
	assert.equal(normalizeAudacityEffectParams('audacity-filter-curve-eq', { points: curve, filterLength: 100 }).filterLength, 101);
	assert.deepEqual(normalizeAudacityEffectParams('audacity-filter-curve-eq', { points: [] }).points, []);
	assert.deepEqual(normalizeAudacityEffectParams('audacity-filter-curve-eq', { points: [{ frequency: 1_000, gain: 3 }] }).points, [{ frequency: 1_000, gain: 3 }]);
	assert.equal(normalizeAudacityEffectParams('audacity-noise-reduction', { frequencySmoothingBands: 6.7 }).frequencySmoothingBands, 7);
	assert.equal(normalizeAudacityEffectParams('audacity-phaser', { feedbackPercent: 4.6 }).feedbackPercent, 5);
	assert.equal(normalizeAudacityEffectParams('audacity-phaser', { stages: 3 }).stages, 2);
	assert.equal(normalizeAudacityEffectParams('audacity-phaser', { stages: 23 }).stages, 22);
	assert.equal(normalizeAudacityEffectParams('audacity-truncate-silence').independent, false);
	assert.equal(normalizeAudacityEffectParams('audacity-truncate-silence', { independent: true }).independent, true);
	assert.equal(
		audacityEffectParameterLabel('audacity-truncate-silence', 'independent'),
		'Truncate tracks independently',
	);
});

test('Audacity parameter normalization rejects invalid ranges and shapes', () => {
	assert.throws(() => normalizeAudacityEffectParams('audacity-click-removal', { threshold: 901 }), /between 0 and 900/);
	assert.throws(() => normalizeAudacityEffectParams('audacity-distortion', { mode: 'unknown' }), /supported option/);
	assert.throws(() => normalizeAudacityEffectParams('audacity-filter-curve-eq', { points: [{ frequency: 20, gain: 0 }, { frequency: 20, gain: 1 }] }), /unique/);
	assert.throws(() => normalizeAudacityEffectParams('audacity-graphic-eq', { gains: [0] }), /31 band gains/);
	assert.throws(() => audacityEffectDefaults('change-pitch'), /Unsupported Audacity effect/);
});
