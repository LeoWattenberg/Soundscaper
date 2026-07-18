import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDIO_RACK_EFFECT_DEFINITIONS,
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	AUDACITY_RACK_EFFECT_TYPES,
	PARAMETRIC_EQ_BAND_TYPES,
	PARAMETRIC_EQ_MAXIMUM_BANDS,
	PARAMETRIC_EQ_SLOPES,
	audioEffectLabel,
	audioEffectParamRange,
	audioEffectTypes,
	audioSelectionEffectDefaults,
	audioSelectionEffectLabel,
	audioSelectionEffectTypes,
	createEffect,
	createMissingEffect,
	effectTailFrames,
	isAudacityRackEffectType,
	missingEffectLabel,
	normalizeAudioSelectionEffectParams,
	normalizeEffect,
	rackTailFrames,
	updateEffect,
	validateEffect,
} from '../src/lib/tools/audio-editor/effects.js';
import {
	AUDACITY_EFFECT_DEFINITIONS,
	audacityEffectDefaults,
	audacityEffectLabel,
	audacityEffectTypes,
} from '../src/lib/tools/audio-editor/audacity-effects/manifest.js';
import {
	AUDACITY_LIVE_EFFECT_CAPABILITIES,
	audacityLiveEffectCapability,
	isAudacityLiveEffect,
} from '../src/lib/tools/audio-editor/audacity-effects/live.js';

const EXPECTED_AUDACITY_RACK_TYPES = [
	'audacity-auto-duck',
	'audacity-bass-treble',
	'audacity-click-removal',
	'audacity-compressor',
	'audacity-distortion',
	'audacity-echo',
	'audacity-filter-curve-eq',
	'audacity-graphic-eq',
	'audacity-invert',
	'audacity-limiter',
	'audacity-noise-reduction',
	'audacity-phaser',
	'audacity-classic-filters',
	'audacity-wahwah',
];

const EXPECTED_SELECTION_ONLY_TYPES = [
	'audacity-amplify',
	'audacity-change-pitch',
	'audacity-change-tempo',
	'audacity-change-speed-pitch',
	'audacity-sliding-stretch',
	'audacity-legacy-compressor',
	'audacity-fade-in',
	'audacity-fade-out',
	'audacity-loudness-normalization',
	'audacity-normalize',
	'audacity-paulstretch',
	'audacity-repair',
	'audacity-remove-dc-offset',
	'audacity-reverb',
	'audacity-repeat',
	'audacity-reverse',
	'audacity-truncate-silence',
];

test('rack registry exposes the existing effects and exactly the live-capable Audacity effects', () => {
	assert.deepEqual(AUDACITY_RACK_EFFECT_TYPES, EXPECTED_AUDACITY_RACK_TYPES);
	assert.deepEqual(
		audioEffectTypes(),
		[...Object.keys(AUDIO_EFFECT_DEFINITIONS), ...EXPECTED_AUDACITY_RACK_TYPES],
	);
	assert.deepEqual(Object.keys(AUDIO_RACK_EFFECT_DEFINITIONS), audioEffectTypes());
	assert.equal(new Set(audioEffectTypes()).size, audioEffectTypes().length);

	for (const type of EXPECTED_AUDACITY_RACK_TYPES) {
		assert.equal(isAudacityRackEffectType(type), true);
		assert.equal(AUDIO_RACK_EFFECT_DEFINITIONS[type], AUDACITY_EFFECT_DEFINITIONS[type]);
	}
	for (const type of EXPECTED_SELECTION_ONLY_TYPES) assert.equal(isAudacityRackEffectType(type), false);
	assert.deepEqual(
		audacityEffectTypes().filter((type) => !isAudacityRackEffectType(type)),
		EXPECTED_SELECTION_ONLY_TYPES,
	);
});

test('manifest capabilities, rack registry, and live predicate share one exact boundary', () => {
	assert.deepEqual(Object.keys(AUDACITY_LIVE_EFFECT_CAPABILITIES), audacityEffectTypes());
	assert.deepEqual(
		Object.values(AUDACITY_LIVE_EFFECT_CAPABILITIES)
			.filter((capability) => capability.live)
			.map((capability) => capability.type),
		EXPECTED_AUDACITY_RACK_TYPES,
	);

	for (const type of audacityEffectTypes()) {
		const capability = audacityLiveEffectCapability(type);
		const expectedLive = EXPECTED_AUDACITY_RACK_TYPES.includes(type);
		assert.equal(capability.type, type);
		assert.equal(capability.live, expectedLive);
		assert.equal(capability.mode, expectedLive ? 'live' : 'selection-only');
		assert.equal(isAudacityLiveEffect(type), expectedLive);
		assert.equal(isAudacityRackEffectType(type), expectedLive);
		if (!expectedLive) assert.equal(typeof capability.reason === 'string' && capability.reason.length > 0, true);
	}

	for (const type of Object.keys(AUDIO_EFFECT_DEFINITIONS)) assert.equal(isAudacityLiveEffect(type), false);
	assert.equal(isAudacityLiveEffect('not-an-effect'), false);
	assert.throws(() => audacityLiveEffectCapability('not-an-effect'), /Unsupported Audacity effect/);
});

test('all live-capable Audacity effects create, normalize, and update through manifest defaults', () => {
	for (const type of EXPECTED_AUDACITY_RACK_TYPES) {
		const effect = createEffect(type, { id: `rack-${type}` });
		assert.equal(effect.type, type);
		assert.equal(effect.enabled, true);
		assert.deepEqual(effect.params, audacityEffectDefaults(type));
		assert.equal(validateEffect(effect), true);

		const normalized = normalizeEffect(effect);
		assert.deepEqual(normalized, effect);
		assert.notEqual(normalized, effect);
		assert.notEqual(normalized.params, effect.params);

		const disabled = updateEffect(effect, { enabled: false, params: {} });
		assert.equal(disabled.enabled, false);
		assert.deepEqual(disabled.params, effect.params);
	}

	assert.equal(createEffect('audacity-compressor', {
		id: 'compressor', params: { thresholdDb: -30, ratio: 3 },
	}).params.thresholdDb, -30);
	assert.throws(
		() => createEffect('audacity-compressor', { id: 'bad', params: { thresholdDb: -61 } }),
		/between -60 and 0/,
	);
	assert.throws(
		() => createEffect('audacity-graphic-eq', { id: 'bad', params: { gains: [0] } }),
		/requires 31 band gains/,
	);
	assert.throws(
		() => createEffect('audacity-noise-reduction', { id: 'bad', params: { output: 'invalid' } }),
		/not a supported option/,
	);
	assert.deepEqual(audioEffectParamRange('audacity-echo', 'delaySeconds'), [0.001, 10]);
	assert.deepEqual(audioEffectParamRange('audacity-echo', 'decay'), [0, 0.999]);
	assert.deepEqual(audioEffectParamRange('audacity-auto-duck', 'maximumPause'), [0, 7]);
	assert.throws(
		() => createEffect('audacity-echo', { id: 'unsafe-delay', params: { delaySeconds: 10.001 } }),
		/between 0.001 and 10/,
	);
	assert.throws(
		() => createEffect('audacity-echo', { id: 'unstable-decay', params: { decay: 1 } }),
		/between 0 and 0.999/,
	);
});

test('selection-only Audacity effects are rejected by the realtime rack model', () => {
	for (const type of EXPECTED_SELECTION_ONLY_TYPES) {
		assert.throws(() => createEffect(type, { id: `rack-${type}` }), /Unsupported audio effect/);
	}
	const live = createEffect('audacity-invert', { id: 'invert' });
	assert.throws(() => updateEffect(live, { type: 'audacity-reverse' }), /Unsupported audio effect/);
});

test('missing rack effects preserve identity but are permanently inert locally', () => {
	const opaque = {
		kind: 'node',
		node: {
			name: 'effect',
			content: [{ kind: 'blob', name: 'state', value: Uint8Array.of(1, 2, 3) }],
		},
	};
	const missing = createMissingEffect({
		id: 'missing-superverb',
		enabled: true,
		missing: {
			name: 'SuperVerb',
			nativeId: 'Effect_VST3_Acme_SuperVerb_/plugins/superverb.vst3',
			reason: 'plugin-unavailable',
			source: 'aup4',
		},
		opaqueAudacityNode: opaque,
	});
	assert.deepEqual({
		type: missing.type,
		enabled: missing.enabled,
		bypassed: missing.bypassed,
		params: missing.params,
		label: missingEffectLabel(missing),
	}, {
		type: 'missing',
		enabled: true,
		bypassed: true,
		params: {},
		label: 'Missing: SuperVerb',
	});
	assert.equal(effectTailFrames(missing), 0);
	assert.equal(rackTailFrames([missing]), 0);

	opaque.node.content[0].value[0] = 99;
	assert.deepEqual(missing.opaqueAudacityNode.node.content[0].value, Uint8Array.of(1, 2, 3));
	const normalized = normalizeEffect(missing);
	const disabled = updateEffect(normalized, {
		enabled: false,
		bypassed: false,
		params: { unsafe: true },
		missing: { name: 'Changed' },
	});
	assert.equal(disabled.enabled, false);
	assert.equal(disabled.bypassed, true);
	assert.deepEqual(disabled.params, {});
	assert.deepEqual(disabled.missing, missing.missing);
	assert.notEqual(disabled.opaqueAudacityNode, missing.opaqueAudacityNode);

	const replacement = updateEffect(missing, { type: 'highpass', params: { frequency: 160 } });
	assert.equal(replacement.type, 'highpass');
	assert.equal(replacement.params.frequency, 160);
	assert.equal('missing' in replacement, false);
});

test('zero-wet native delay and reverb racks are tail-free', () => {
	const delay = createEffect('delay', {
		id: 'dry-delay',
		params: { time: 1, feedback: 0.9, mix: 0 },
	});
	const reverb = createEffect('reverb', {
		id: 'dry-reverb',
		params: { decay: 10, preDelay: 1, mix: 0 },
	});
	assert.equal(effectTailFrames(delay), 0);
	assert.equal(effectTailFrames(reverb), 0);
	assert.equal(rackTailFrames([delay, reverb]), 0);
	assert.ok(effectTailFrames(updateEffect(delay, { params: { mix: 0.5 } })) > 0);
	assert.ok(effectTailFrames(updateEffect(reverb, { params: { mix: 0.5 } })) > 0);
});

test('parametric EQ normalizes the legacy four-band model into the canonical extensible schema', () => {
	const legacy = {
		id: 'legacy-eq',
		type: 'eq',
		enabled: true,
		params: {
			bands: [100, 500, 2_000, 8_000].map((frequency) => ({ frequency, gain: 0, q: 1 })),
		},
	};
	const normalized = normalizeEffect(legacy);
	assert.equal(normalized.params.outputGain, 0);
	assert.deepEqual(normalized.params.bands, [100, 500, 2_000, 8_000].map((frequency, index) => ({
		id: `legacy-eq-band-${index + 1}`,
		enabled: true,
		type: 'peaking',
		frequency,
		gain: 0,
		q: 1,
		slope: 12,
	})));
	assert.equal('outputGain' in legacy.params, false);
	assert.equal('id' in legacy.params.bands[0], false);
	assert.deepEqual(audioSelectionEffectDefaults('eq').bands.map((band) => band.id), [
		'band-1',
		'band-2',
		'band-3',
		'band-4',
	]);
	assert.deepEqual(normalizeAudioSelectionEffectParams('eq', legacy.params, legacy.id), normalized.params);
	assert.equal(normalizeEffect({ ...legacy, type: 'parametric_eq' }).type, 'eq');
	assert.equal(normalizeEffect({ ...legacy, type: 'parametric-eq' }).type, 'eq');
});

test('parametric EQ accepts zero through twelve uniquely identified bands and validates every control', () => {
	assert.deepEqual(createEffect('eq', { id: 'empty', params: { outputGain: -3, bands: [] } }).params, {
		outputGain: -3,
		bands: [],
	});
	const bands = Array.from({ length: PARAMETRIC_EQ_MAXIMUM_BANDS }, (_, index) => ({
		id: `node-${index}`,
		enabled: index % 2 === 0,
		type: PARAMETRIC_EQ_BAND_TYPES[index % PARAMETRIC_EQ_BAND_TYPES.length],
		frequency: 20 * 1_000 ** (index / (PARAMETRIC_EQ_MAXIMUM_BANDS - 1)),
		gain: index - 6,
		q: 0.5 + index,
		slope: PARAMETRIC_EQ_SLOPES[index % PARAMETRIC_EQ_SLOPES.length],
	}));
	const effect = createEffect('eq', { id: 'full', params: { outputGain: 6, bands } });
	assert.deepEqual(effect.params, { outputGain: 6, bands });
	assert.equal(audioEffectParamRange('eq', 'outputGain')[1], 24);

	const thirteen = [...bands, { ...bands[0], id: 'node-12' }];
	assert.throws(() => createEffect('eq', { id: 'too-many', params: { bands: thirteen } }), /zero and 12 bands/);
	assert.throws(() => createEffect('eq', {
		id: 'duplicate', params: { bands: [{ ...bands[0], id: 'same' }, { ...bands[1], id: 'same' }] },
	}), /Duplicate parametric EQ band ID/);
	for (const [change, pattern] of [
		[{ id: ' ' }, /non-empty string/],
		[{ enabled: 1 }, /must be a boolean/],
		[{ type: 'bandpass' }, /must be one of/],
		[{ slope: 18 }, /must be one of/],
		[{ frequency: 9 }, /between 10 and 24000/],
		[{ gain: 25 }, /between -24 and 24/],
		[{ q: 31 }, /between 0.1 and 30/],
	]) {
		assert.throws(() => createEffect('eq', {
			id: 'invalid-band', params: { bands: [{ ...bands[0], ...change }] },
		}), pattern);
	}
	assert.throws(() => createEffect('eq', {
		id: 'invalid-output', params: { outputGain: -25, bands: [] },
	}), /between -24 and 24/);
});

test('selection effect registry adds canonical EQ without changing the Audacity inventory order', () => {
	assert.deepEqual(audioSelectionEffectTypes(), [...audacityEffectTypes(), 'eq']);
	assert.equal(AUDIO_SELECTION_EFFECT_DEFINITIONS.eq.maximumBands, 12);
	assert.equal(AUDIO_SELECTION_EFFECT_DEFINITIONS.eq.preRollSeconds, 10);
	assert.equal(audioSelectionEffectLabel('eq', 'en'), audioEffectLabel('eq', 'en'));
	assert.throws(() => audioSelectionEffectDefaults('compressor'), /Unsupported selection effect/);
});

test('rack labels keep studio collisions distinct from their Audacity implementations', () => {
	assert.equal(audioEffectLabel('compressor', 'en'), 'Compressor');
	assert.equal(audioEffectLabel('audacity-compressor', 'en'), 'Compressor (Audacity)');
	assert.equal(audioEffectLabel('compressor', 'de'), 'Kompressor');
	assert.equal(audioEffectLabel('audacity-compressor', 'de'), 'Kompressor (Audacity)');
	assert.equal(audioEffectLabel('limiter', 'en'), 'Limiter');
	assert.equal(audioEffectLabel('audacity-limiter', 'en'), 'Limiter (Audacity)');
	assert.equal(audioEffectLabel('compressor', { effectNameCompressor: 'Remote dynamics' }), 'Remote dynamics');
	for (const type of EXPECTED_AUDACITY_RACK_TYPES) {
		assert.equal(audioEffectLabel(type, 'en'), audacityEffectLabel(type, 'en'));
		assert.equal(audioEffectLabel(type, 'de'), audacityEffectLabel(type, 'de'));
	}
	assert.throws(() => audioEffectLabel('audacity-normalize'), /Unsupported audio effect/);
});

test('rack effects preserve cloned JSON-safe sidechain, profile, range, and cache metadata', () => {
	const context = {
		controlTrackId: 'track-2',
		noiseProfile: { sampleRate: 48_000, meanPowers: [0.125, 0.25] },
		range: { startFrame: 120, endFrame: 960 },
	};
	const state = { prepared: true, cache: { key: 'rack-cache-v1', revision: 3 } };
	const effect = createEffect('audacity-auto-duck', {
		id: 'duck', context, state,
	});

	context.controlTrackId = 'mutated';
	context.noiseProfile.meanPowers[0] = 99;
	state.cache.key = 'mutated';
	assert.equal(effect.context.controlTrackId, 'track-2');
	assert.deepEqual(effect.context.noiseProfile.meanPowers, [0.125, 0.25]);
	assert.equal(effect.state.cache.key, 'rack-cache-v1');

	const updated = updateEffect(effect, {
		params: { duckAmountDb: -18 },
		context: { range: { startFrame: 240, endFrame: 1_200 } },
		state: { cache: { key: 'rack-cache-v2', revision: 4 } },
	});
	assert.equal(updated.params.duckAmountDb, -18);
	assert.equal(updated.context.controlTrackId, 'track-2');
	assert.deepEqual(updated.context.noiseProfile.meanPowers, [0.125, 0.25]);
	assert.deepEqual(updated.context.range, { startFrame: 240, endFrame: 1_200 });
	assert.equal(updated.state.prepared, true);
	assert.deepEqual(updated.state.cache, { key: 'rack-cache-v2', revision: 4 });

	const serialized = JSON.parse(JSON.stringify(updated));
	assert.deepEqual(normalizeEffect(serialized), serialized);
	assert.notEqual(normalizeEffect(serialized).context, serialized.context);

	const reduction = createEffect('audacity-noise-reduction', {
		id: 'noise-reduction',
		context: { noiseProfile: { version: 1, sampleRate: 48_000, meanPowers: [0.1, 0.2, 0.3] } },
	});
	assert.deepEqual(
		updateEffect(reduction, { params: { reductionDb: 12 } }).context,
		reduction.context,
	);
	assert.equal(updateEffect(reduction, { context: null }).context, null);
});

test('rack metadata rejects values that cannot be safely persisted as JSON', () => {
	assert.throws(
		() => createEffect('audacity-auto-duck', { id: 'bad', context: { value: Number.NaN } }),
		/numbers must be finite/,
	);
	assert.throws(
		() => createEffect('audacity-noise-reduction', { id: 'bad', context: { meanPowers: new Float32Array(2) } }),
		/plain objects and arrays/,
	);
	assert.throws(
		() => createEffect('audacity-auto-duck', { id: 'bad', state: { prepare: () => {} } }),
		/only JSON-safe values/,
	);
	assert.throws(
		() => createEffect('audacity-auto-duck', { id: 'bad', state: new Date() }),
		/JSON-safe object or null/,
	);
	const circular = {};
	circular.self = circular;
	assert.throws(
		() => createEffect('audacity-auto-duck', { id: 'bad', context: circular }),
		/circular references/,
	);
});
