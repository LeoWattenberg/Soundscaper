import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_EFFECT_MACRO_COMMANDS,
	createEffectMacroDraft,
	normalizeEffectMacroDraft,
	parseAudacityEffectMacro,
	serializeAudacityEffectMacro,
} from '../src/lib/tools/audio-editor/effect-macros.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDACITY_RACK_EFFECT_TYPES,
	createEffect,
} from '../src/lib/tools/audio-editor/effects.js';

test('Audacity effect macro export uses scripting IDs, stable parameter names, and settings only', () => {
	const effects = [
		createEffect('audacity-compressor', {
			id: 'compressor-private-id',
			params: {
				thresholdDb: -18,
				makeupGainDb: 2,
				kneeWidthDb: 4,
				ratio: 6,
				lookaheadMs: 5,
				attackMs: 12,
				releaseMs: 240,
			},
			context: { routing: 'private' },
		}),
		createEffect('audacity-distortion', {
			id: 'disabled-private-id',
			enabled: false,
		}),
		createEffect('highpass', {
			id: 'native-private-id',
			params: { frequency: 125, q: 0.9 },
			state: { privateCache: true },
		}),
		createEffect('audacity-invert', { id: 'invert-private-id' }),
	];

	const exported = serializeAudacityEffectMacro(effects);
	assert.equal(exported, [
		'Compressor:thresholdDb="-18" makeupGainDb="2" kneeWidthDb="4" compressionRatio="6" lookaheadMs="5" attackMs="12" releaseMs="240"',
		'SoundscaperEffect:Type="highpass" Params="{\\"frequency\\":125,\\"q\\":0.9}"',
		'Invert:',
		'',
	].join('\n'));
	assert.doesNotMatch(exported, /private|enabled|context|state|Distortion/);
});

test('all fourteen realtime Audacity profiles round-trip through concrete macro settings', () => {
	assert.equal(Object.keys(AUDACITY_EFFECT_MACRO_COMMANDS).length, 14);
	assert.deepEqual(Object.keys(AUDACITY_EFFECT_MACRO_COMMANDS), AUDACITY_RACK_EFFECT_TYPES);
	const source = AUDACITY_RACK_EFFECT_TYPES.map((type, index) => createEffect(type, { id: `source-${index}` }));
	const parsed = parseAudacityEffectMacro(serializeAudacityEffectMacro(source), {
		idFactory: (_prefix, index) => `parsed-${index}`,
	});
	assert.deepEqual(parsed.effects.map(({ type }) => type), AUDACITY_RACK_EFFECT_TYPES);
	assert.deepEqual(parsed.effects.map(({ params }) => params), source.map(({ params }) => params));
	assert.ok(parsed.effects.every(({ enabled }) => enabled));
});

test('Noise Reduction settings use the Soundscaper extension instead of an unresolved Audacity preset', () => {
	const effect = createEffect('audacity-noise-reduction', {
		id: 'noise-reduction',
		params: {
			reductionDb: 18,
			sensitivity: 7.25,
			frequencySmoothingBands: 4,
			output: 'residue',
		},
	});
	const exported = serializeAudacityEffectMacro([effect]);
	assert.equal(exported, 'SoundscaperEffect:Type="audacity-noise-reduction" Params="{\\"reductionDb\\":18,\\"sensitivity\\":7.25,\\"frequencySmoothingBands\\":4,\\"output\\":\\"residue\\"}"\n');
	assert.doesNotMatch(exported, /^NoiseReduction:/);
	assert.deepEqual(parseAudacityEffectMacro(exported, {
		idFactory: () => 'imported-noise-reduction',
	}).effects[0].params, effect.params);

	const audacityFixture = 'NoiseReduction:Use_Preset="<Current Settings>"';
	assert.throws(() => parseAudacityEffectMacro(audacityFixture),
		/NoiseReduction references unresolved Audacity preset "<Current Settings>"; its settings are not stored in the macro text/);
});

test('Noise Reduction extension preserves and validates a standalone captured profile', () => {
	const noiseProfile = {
		type: 'audacity-noise-profile',
		version: 1,
		sampleRate: 48_000,
		windowSize: 2_048,
		stepsPerWindow: 4,
		windowType: 'hann-hann',
		channelCount: 2,
		windowCount: 12,
		meanPowers: Array.from({ length: 1_025 }, (_unused, index) => (index + 1) / 1_000_000),
	};
	const effect = createEffect('audacity-noise-reduction', {
		id: 'profiled-noise-reduction',
		context: { noiseProfile },
	});
	const exported = serializeAudacityEffectMacro([effect]);
	assert.match(exported, /^SoundscaperEffect:Type="audacity-noise-reduction" Params=".*" Context="/);
	const imported = parseAudacityEffectMacro(exported, {
		idFactory: () => 'imported-profiled-noise-reduction',
	}).effects[0];
	assert.deepEqual(imported.context, { noiseProfile });
	assert.ok(Object.isFrozen(imported.context));
	assert.ok(Object.isFrozen(imported.context.noiseProfile.meanPowers));
	const draft = normalizeEffectMacroDraft({
		id: 'standalone-noise-macro',
		name: 'Standalone denoise',
		effects: [imported],
	});
	assert.deepEqual(draft.effects[0].context, { noiseProfile });

	const invalidProfileFixture = 'SoundscaperEffect:Type="audacity-noise-reduction" Params="{}" Context="{\\"noiseProfile\\":{\\"type\\":\\"audacity-noise-profile\\",\\"version\\":1,\\"sampleRate\\":48000,\\"windowSize\\":2048,\\"stepsPerWindow\\":4,\\"meanPowers\\":[]}}"';
	assert.throws(() => parseAudacityEffectMacro(invalidProfileFixture), /profile spectrum is invalid/);
	assert.throws(() => serializeAudacityEffectMacro([
		createEffect('audacity-noise-reduction', {
			id: 'invalid-profile',
			context: { noiseProfile: { ...noiseProfile, meanPowers: [] } },
		}),
	]), /profile spectrum is invalid/);
	assert.throws(() => parseAudacityEffectMacro(
		'SoundscaperEffect:Type="highpass" Params="{\\"frequency\\":80,\\"q\\":0.707}" Context="{}"',
	), /Context is supported only for Noise Reduction/);
});

test('GraphicEq import resamples arbitrary Audacity curve points onto the fixed 31 bands', () => {
	const audacityFixture = 'GraphicEq:FilterLength="4095" InterpolateLin="0" InterpolationMethod="Cosine" f0="20" v0="-6" f1="200" v1="0" f2="2000" v2="6" f3="20000" v3="0"';
	const effect = parseAudacityEffectMacro(audacityFixture, {
		idFactory: () => 'imported-graphic-eq',
	}).effects[0];

	assert.equal(effect.type, 'audacity-graphic-eq');
	assert.equal(effect.params.filterLength, 4_095);
	assert.equal(effect.params.interpolation, 'cosine');
	assert.equal(effect.params.gains.length, 31);
	assert.equal(effect.params.gains[0], -6);
	assert.ok(Math.abs(effect.params.gains[5] - -3.010_136_677_262_397) < 1e-12);
	assert.ok(Math.abs(effect.params.gains[10]) < 1e-12);
	assert.ok(Math.abs(effect.params.gains[20] - 6) < 1e-12);
	assert.equal(effect.params.gains[30], 0);
});

test('GraphicEq import accepts at most 200 contiguous Audacity curve points', () => {
	const points = Array.from({ length: 200 }, (_unused, index) => {
		const frequency = 20 * (1_000 ** (index / 199));
		return `f${index}="${frequency}" v${index}="${Math.sin(index / 12)}"`;
	});
	const effect = parseAudacityEffectMacro(`GraphicEq:${points.join(' ')}`, {
		idFactory: () => 'imported-graphic-eq-200',
	}).effects[0];
	assert.equal(effect.params.gains.length, 31);
	assert.throws(() => parseAudacityEffectMacro(
		`GraphicEq:${points.join(' ')} f200="22000" v200="0"`,
	), /at most 200 points/);
});

test('Soundscaper native effects use the bounded namespaced extension and round-trip', () => {
	const source = Object.keys(AUDIO_EFFECT_DEFINITIONS)
		.map((type, index) => createEffect(type, { id: `native-${index}` }));
	const exported = serializeAudacityEffectMacro(source);
	assert.equal(exported.match(/^SoundscaperEffect:/gm)?.length, source.length);
	const parsed = parseAudacityEffectMacro(exported, {
		idFactory: (_prefix, index) => `opened-${index}`,
	});
	assert.deepEqual(parsed.effects.map(({ type, params }) => ({ type, params })),
		source.map(({ type, params }) => ({ type, params })));
	assert.throws(() => parseAudacityEffectMacro(
		'SoundscaperEffect:Type="audacity-invert" Params="{}"',
	), /Unsupported Soundscaper effect type/);
	assert.throws(() => parseAudacityEffectMacro(
		'SoundscaperEffect:Type="highpass" Params="{\\"frequency\\":80,\\"q\\":0.707,\\"future\\":1}"',
	), /Unsupported highpass parameter: future/);
});

test('import handles BOM, CRLF, blank lines, decimal commas, aliases, and ignored commands', () => {
	const text = [
		'\ufeffSelectAll:',
		'',
		'Echo:Delay="0,25" Decay="0,4"',
		'ScienFilter:FilterType="Butterworth" FilterSubtype="Lowpass" Order="4" Cutoff="1200" PassbandRipple="1" StopbandRipple="30"',
		'ExportWav:Filename="ignored.wav"',
		'SelectAll:',
		'',
	].join('\r\n');
	const parsed = parseAudacityEffectMacro(text, {
		idFactory: (_prefix, index) => `imported-${index}`,
	});
	assert.deepEqual(parsed.effects.map(({ id, type }) => ({ id, type })), [
		{ id: 'imported-0', type: 'audacity-echo' },
		{ id: 'imported-1', type: 'audacity-classic-filters' },
	]);
	assert.equal(parsed.effects[0].params.delaySeconds, 0.25);
	assert.equal(parsed.effects[0].params.decay, 0.4);
	assert.equal(parsed.effects[1].params.cutoffHz, 1_200);
	assert.deepEqual(parsed.ignoredCommands, ['SelectAll', 'ExportWav']);
	assert.ok(Object.isFrozen(parsed));
	assert.ok(Object.isFrozen(parsed.effects));
	assert.ok(Object.isFrozen(parsed.effects[0]));
	assert.ok(Object.isFrozen(parsed.effects[0].params));
	assert.ok(Object.isFrozen(parsed.ignoredCommands));
});

test('Audacity quoting and underscore-normalized enum and boolean parameters round-trip', () => {
	const effect = createEffect('audacity-distortion', {
		id: 'distortion',
		params: {
			mode: 'cubic',
			dcBlock: true,
			thresholdDb: -9,
			noiseFloorDb: -65,
			parameter1: 25,
			parameter2: 75,
			repeats: 2,
		},
	});
	const exported = serializeAudacityEffectMacro([effect]);
	assert.match(exported, /Type="Cubic Curve \(odd harmonics\)"/);
	assert.match(exported, /DC_Block="1" Threshold_dB="-9" Noise_Floor="-65"/);
	assert.deepEqual(parseAudacityEffectMacro(exported, { idFactory: () => 'opened' }).effects[0].params,
		effect.params);

	const extension = 'SoundscaperEffect:Type="highpass" Params="{\\"frequency\\":125,\\"q\\":0.9}"';
	assert.deepEqual(parseAudacityEffectMacro(extension, { idFactory: () => 'native' }).effects[0].params,
		{ frequency: 125, q: 0.9 });
});

test('supported malformed lines reject the whole import before IDs are allocated', () => {
	let idCalls = 0;
	assert.throws(() => parseAudacityEffectMacro([
		'Invert:',
		'Echo:Delay="0.25" Decay="unterminated',
	].join('\n'), { idFactory: () => `effect-${++idCalls}` }), /line 2.*unterminated/);
	assert.equal(idCalls, 0);
	assert.throws(() => parseAudacityEffectMacro('Echo:Delay=0.25'), /line 1.*quoted/);
	assert.throws(() => parseAudacityEffectMacro('Echo:Delay="0.25\\q"'), /unsupported \\q escape/);
	assert.throws(() => parseAudacityEffectMacro('Echo:Use_Preset="Telephone"'), /unresolved Audacity preset/);
	assert.throws(() => parseAudacityEffectMacro('Echo:Future="1"'), /Unsupported Echo parameter/);
	assert.throws(() => parseAudacityEffectMacro('FilterCurve:f0="20"'), /contiguous fN\/vN pairs/);
	assert.throws(() => parseAudacityEffectMacro('SelectAll:\nExportWav:'), /no supported effects/);
	assert.throws(() => serializeAudacityEffectMacro([
		createEffect('audacity-invert', { id: 'off', enabled: false }),
	]), /at least one enabled effect/);
});

test('macro drafts are immutable settings-only chains with stable private IDs', () => {
	let sequence = 0;
	const draft = createEffectMacroDraft({
		name: '  Podcast voice  ',
		effects: [
			createEffect('audacity-invert', {
				id: 'invert-step',
				context: { shouldDisappear: true },
				state: { shouldDisappear: true },
			}),
			createEffect('delay', { id: 'disabled-step', enabled: false }),
			{ type: 'highpass', params: { frequency: 100, q: 1 } },
		],
		idFactory: (prefix) => `${prefix}-${++sequence}`,
	});
	assert.equal(draft.id, 'macro-1');
	assert.equal(draft.name, 'Podcast voice');
	assert.deepEqual(draft.effects.map(({ id, type }) => ({ id, type })), [
		{ id: 'invert-step', type: 'audacity-invert' },
		{ id: 'effect-2', type: 'highpass' },
	]);
	assert.equal('context' in draft.effects[0], false);
	assert.equal('state' in draft.effects[0], false);
	assert.ok(draft.effects.every(({ enabled }) => enabled));
	assert.ok(Object.isFrozen(draft));
	assert.ok(Object.isFrozen(draft.effects));
	assert.ok(Object.isFrozen(draft.effects[1].params));

	const normalized = normalizeEffectMacroDraft(draft);
	assert.deepEqual(normalized, draft);
	assert.throws(() => normalizeEffectMacroDraft({
		id: 'duplicate-macro',
		name: 'Duplicate IDs',
		effects: [
			createEffect('audacity-invert', { id: 'same' }),
			createEffect('audacity-invert', { id: 'same' }),
		],
	}), /IDs must be unique/);
});
