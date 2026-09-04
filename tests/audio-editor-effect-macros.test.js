import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_EFFECT_MACRO_COMMANDS,
	createEffectMacroDraft,
	normalizeEffectMacroDraft,
	parseAudacityEffectMacro,
	serializeAudacityEffectMacro,
} from '../src/common/editor/effect-macros.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDACITY_RACK_EFFECT_TYPES,
	createEffect,
} from '../src/common/editor/effects.js';

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

test('every Audacity effect with a macro command round-trips through concrete macro settings', () => {
	// Audacity derives a macro command by capitalizing the words of the effect's
	// own symbol, so these are the commands its Macro Manager lists.
	assert.deepEqual(AUDACITY_EFFECT_MACRO_COMMANDS, {
		'audacity-auto-duck': 'AutoDuck',
		'audacity-bass-treble': 'BassAndTreble',
		'audacity-click-removal': 'ClickRemoval',
		'audacity-compressor': 'Compressor',
		'audacity-distortion': 'Distortion',
		'audacity-echo': 'Echo',
		'audacity-filter-curve-eq': 'FilterCurve',
		'audacity-graphic-eq': 'GraphicEq',
		'audacity-invert': 'Invert',
		'audacity-limiter': 'Limiter',
		'audacity-noise-reduction': 'NoiseReduction',
		'audacity-phaser': 'Phaser',
		'audacity-classic-filters': 'ClassicFilters',
		'audacity-wahwah': 'Wahwah',
		'audacity-amplify': 'Amplify',
		'audacity-change-pitch': 'ChangePitch',
		'audacity-change-speed-pitch': 'ChangeSpeedAndPitch',
		'audacity-change-tempo': 'ChangeTempo',
		'audacity-fade-in': 'FadeIn',
		'audacity-fade-out': 'FadeOut',
		'audacity-legacy-compressor': 'LegacyCompressor',
		'audacity-loudness-normalization': 'LoudnessNormalization',
		'audacity-normalize': 'Normalize',
		'audacity-paulstretch': 'Paulstretch',
		'audacity-repair': 'Repair',
		'audacity-repeat': 'Repeat',
		'audacity-reverb': 'Reverb',
		'audacity-reverse': 'Reverse',
		'audacity-sliding-stretch': 'SlidingStretch',
		'audacity-truncate-silence': 'TruncateSilence',
	});
	for (const type of AUDACITY_RACK_EFFECT_TYPES) {
		assert.ok(AUDACITY_EFFECT_MACRO_COMMANDS[type], `${type} needs a macro command`);
	}

	// Noise Reduction has a command, but its settings only survive the
	// extension, so it is exercised by its own test rather than here.
	const types = Object.keys(AUDACITY_EFFECT_MACRO_COMMANDS)
		.filter((type) => type !== 'audacity-noise-reduction');
	const draft = createEffectMacroDraft({
		name: 'Every command',
		effects: types.map((type) => ({ type })),
		idFactory: (prefix, index) => `source-${prefix}-${index}`,
	});
	const exported = serializeAudacityEffectMacro(draft.effects);
	assert.deepEqual(exported.trimEnd().split('\n').map((line) => line.slice(0, line.indexOf(':'))),
		types.map((type) => AUDACITY_EFFECT_MACRO_COMMANDS[type]));
	const parsed = parseAudacityEffectMacro(exported, {
		idFactory: (_prefix, index) => `parsed-${index}`,
	});
	assert.deepEqual(parsed.effects.map(({ type }) => type), types);
	assert.deepEqual(parsed.effects.map(({ params }) => params), draft.effects.map(({ params }) => params));
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
	assert.throws(() => parseAudacityEffectMacro([
		'SelectAll:',
		'',
		'SoundscaperEffect:Type="highpass" Params="{\\"frequency\\":\\"bad\\nvalue\\"}"',
	].join('\n')), /^SyntaxError: Invalid effect macro line 3:/u);
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

test('offline effects travel as their own Audacity commands', () => {
	const draft = createEffectMacroDraft({
		name: 'Restore and level',
		effects: [
			{ type: 'audacity-click-removal' },
			{ type: 'audacity-normalize', params: { peakDb: -3 } },
			{ type: 'audacity-fade-out' },
		],
		idFactory: (prefix, index) => `${prefix}-${index}`,
	});
	assert.deepEqual(draft.effects.map(({ type }) => type), [
		'audacity-click-removal', 'audacity-normalize', 'audacity-fade-out',
	]);
	assert.equal(draft.effects[1].params.peakDb, -3);

	const exported = serializeAudacityEffectMacro(draft.effects);
	assert.equal(exported, [
		'ClickRemoval:Threshold="200" Width="20"',
		'Normalize:PeakLevel="-3" ApplyVolume="1" RemoveDcOffset="1" StereoIndependent="0"',
		'FadeOut:',
		'',
	].join('\n'));

	const parsed = parseAudacityEffectMacro(exported, {
		idFactory: (prefix, index) => `${prefix}-${index}`,
	});
	assert.deepEqual(
		parsed.effects.map(({ type, params }) => ({ type, params })),
		draft.effects.map(({ type, params }) => ({ type, params })),
	);
});

test('Audacity settings its own commands cannot express keep the extension namespace', () => {
	// Remove DC Offset exists in Soundscaper as its own effect; Audacity only
	// offers it inside Normalize, so it has no command of its own.
	const exported = serializeAudacityEffectMacro([{ type: 'audacity-remove-dc-offset', id: 'dc' }]);
	assert.equal(exported, 'SoundscaperEffect:Type="audacity-remove-dc-offset" Params="{}"\n');
	assert.deepEqual(parseAudacityEffectMacro(exported, { idFactory: () => 'opened' })
		.effects.map(({ type }) => type), ['audacity-remove-dc-offset']);
	assert.throws(() => parseAudacityEffectMacro(
		'SoundscaperEffect:Type="audacity-normalize" Params="{}"',
	), /Unsupported Soundscaper effect type: audacity-normalize/);
});

test('an extension macro step rejects parameters the effect does not define', () => {
	assert.throws(() => parseAudacityEffectMacro(
		'SoundscaperEffect:Type="audacity-noise-reduction" Params="{\\"reductionDb\\":3,\\"future\\":1}"',
	), /Unsupported audacity-noise-reduction parameter: future/);
	assert.throws(() => parseAudacityEffectMacro(
		'SoundscaperEffect:Type="audacity-remove-dc-offset" Params="{}" Context="{}"',
	), /Context is supported only for Noise Reduction/);
});

test('macros Audacity itself wrote import with its own names, units and implied settings', () => {
	const parse = (line) => parseAudacityEffectMacro(line, { idFactory: () => 'imported' }).effects[0];

	// Audacity stores Amplify as a linear ratio and captures no clipping flag
	// when the effect runs from a macro, where clipping is always allowed.
	assert.deepEqual(parse('Amplify:Ratio="2"').params, { gainDb: 6.0205999133, allowClipping: true });
	assert.equal(parse('Amplify:Ratio="2" AllowClipping="0"').params.allowClipping, false);

	// Audacity 3.7 renamed Normalize's ApplyGain to ApplyVolume.
	assert.deepEqual(parse('Normalize:PeakLevel="-3" ApplyGain="0" RemoveDcOffset="0" StereoIndependent="1"').params,
		{ peakDb: -3, removeDc: false, applyGain: false, stereoIndependent: true });

	// Truncate Silence writes a symbolic action; its pre-2.1.0 index still reads.
	assert.equal(parse('TruncateSilence:Action="Compress Excess Silence"').params.action, 'compress');
	assert.equal(parse('TruncateSilence:Action="1"').params.action, 'compress');

	// Loudness Normalization writes its target as a bare index, not a symbol.
	assert.equal(parse('LoudnessNormalization:NormalizeTo="1" RMSLevel="-18"').params.mode, 'rms');
	assert.equal(parse('LoudnessNormalization:NormalizeTo="0"').params.mode, 'lufs');

	// Change Pitch stores a percentage change in frequency, and its engine
	// choice has no Soundscaper counterpart.
	assert.equal(parse('ChangePitch:Percentage="100" SBSMS="1"').params.semitones, 12);
	assert.equal(parse('ChangeTempo:Percentage="25" SBSMS="0"').params.tempoPercent, 25);
	assert.equal(parse('ChangeSpeedAndPitch:Percentage="-30"').params.speedPercent, -30);

	// Sliding Stretch writes the pitch slide as half steps and as a percentage;
	// Audacity processes from the percentage, so that is what wins.
	assert.equal(parse('SlidingStretch:PitchHalfStepsStart="5"').params.startPitchSemitones, 5);
	assert.equal(parse('SlidingStretch:PitchHalfStepsStart="5" PitchPercentChangeStart="100"')
		.params.startPitchSemitones, 12);

	assert.throws(() => parseAudacityEffectMacro('Normalize:Future="1"'),
		/Unsupported Normalize parameter: Future/);
});

test('decibel and semitone settings survive a macro round trip through Audacity units', () => {
	for (const gainDb of [0.1, -0.9151498112, 12.3456, -37.5]) {
		const exported = serializeAudacityEffectMacro([{ type: 'audacity-amplify', id: 'a', params: { gainDb } }]);
		assert.equal(parseAudacityEffectMacro(exported, { idFactory: () => 'a' })
			.effects[0].params.gainDb, gainDb);
	}
	for (const semitones of [3, -7.25, 0.01, 12]) {
		const exported = serializeAudacityEffectMacro([
			{ type: 'audacity-change-pitch', id: 'p', params: { semitones } },
		]);
		assert.match(exported, /^ChangePitch:Percentage="[^"]+" SBSMS="0"$/m);
		assert.equal(parseAudacityEffectMacro(exported, { idFactory: () => 'p' })
			.effects[0].params.semitones, semitones);
	}
	const sliding = serializeAudacityEffectMacro([{
		type: 'audacity-sliding-stretch',
		id: 's',
		params: { startPitchSemitones: 5, endPitchSemitones: -3, startTempoPercent: 10, endTempoPercent: -20 },
	}]);
	assert.equal(sliding, 'SlidingStretch:RatePercentChangeStart="10" RatePercentChangeEnd="-20"'
		+ ' PitchHalfStepsStart="5" PitchHalfStepsEnd="-3"'
		+ ' PitchPercentChangeStart="33.48398541700344" PitchPercentChangeEnd="-15.91035847462855"\n');
	assert.deepEqual(parseAudacityEffectMacro(sliding, { idFactory: () => 's' }).effects[0].params, {
		startTempoPercent: 10,
		endTempoPercent: -20,
		startPitchSemitones: 5,
		endPitchSemitones: -3,
		preserveFormants: true,
	});
});
