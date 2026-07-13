/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity native effect inventory and parameter contract.
 * The original inventory is based on Audacity 3.7.7 commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b; StaffPad pitch-and-tempo
 * effects are pinned separately to current Audacity 4 development sources.
 * Audacity is GPL-3.0; individual effect files are GPL-2.0-or-later unless
 * otherwise noted. This JavaScript adaptation was created for kw.media in 2026.
 */

export const AUDACITY_EFFECT_SOURCE = Object.freeze({
	version: '3.7.7',
	commit: '5ef610ed23260d6d648175735bb16b32536eb30b',
	url: 'https://github.com/audacity/audacity/tree/Audacity-3.7.7',
});

export const AUDACITY_STAFFPAD_SOURCE = Object.freeze({
	version: '4-current',
	commit: '908ad0a526e5bfdab68de780e893cebe172d27eb',
	url: 'https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb',
});

const FLOAT_MAX = 3.4028234663852886e38;

export const AUDACITY_EFFECT_UPSTREAM_FILES = deepFreeze({
	'audacity-amplify': [
		'libraries/lib-builtin-effects/AmplifyBase.cpp',
		'src/effects/Amplify.cpp',
	],
	'audacity-auto-duck': ['libraries/lib-builtin-effects/AutoDuckBase.cpp'],
	'audacity-bass-treble': ['libraries/lib-builtin-effects/BassTrebleBase.cpp'],
	'audacity-click-removal': ['libraries/lib-builtin-effects/ClickRemovalBase.cpp'],
	'audacity-change-pitch': [
		'src/effects/builtin_collection/changepitch/changepitcheffect.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
		'au3/libraries/au3-time-and-pitch/FormantShifter.cpp',
	],
	'audacity-change-tempo': [
		'au3/libraries/au3-builtin-effects/ChangeTempoBase.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
	],
	'audacity-change-speed-pitch': [
		'au3/libraries/au3-builtin-effects/ChangeSpeedBase.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
	],
	'audacity-sliding-stretch': [
		'src/effects/builtin_collection/slidingstretch/slidingstretcheffect.cpp',
		'au3/libraries/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp',
		'au3/libraries/au3-time-and-pitch/FormantShifter.cpp',
	],
	'audacity-compressor': [
		'src/effects/Compressor.cpp',
		'libraries/lib-dynamic-range-processor/CompressorProcessor.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/GainReductionComputer.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/LookAheadGainReduction.cpp',
	],
	'audacity-legacy-compressor': ['libraries/lib-builtin-effects/LegacyCompressorBase.cpp'],
	'audacity-distortion': ['libraries/lib-builtin-effects/DistortionBase.cpp'],
	'audacity-echo': ['libraries/lib-builtin-effects/EchoBase.cpp'],
	'audacity-fade-in': ['libraries/lib-builtin-effects/Fade.cpp'],
	'audacity-fade-out': ['libraries/lib-builtin-effects/Fade.cpp'],
	'audacity-filter-curve-eq': [
		'libraries/lib-builtin-effects/EqualizationBase.cpp',
		'libraries/lib-builtin-effects/EqualizationFilter.cpp',
	],
	'audacity-graphic-eq': [
		'libraries/lib-builtin-effects/EqualizationBase.cpp',
		'libraries/lib-builtin-effects/EqualizationFilter.cpp',
		'src/effects/EqualizationBandSliders.cpp',
	],
	'audacity-invert': ['libraries/lib-builtin-effects/Invert.cpp'],
	'audacity-limiter': [
		'src/effects/Limiter.cpp',
		'libraries/lib-dynamic-range-processor/CompressorProcessor.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/GainReductionComputer.cpp',
		'libraries/lib-dynamic-range-processor/SimpleCompressor/LookAheadGainReduction.cpp',
	],
	'audacity-loudness-normalization': [
		'libraries/lib-builtin-effects/LoudnessBase.cpp',
		'libraries/lib-math/EBUR128.cpp',
	],
	'audacity-noise-reduction': ['libraries/lib-builtin-effects/NoiseReductionBase.cpp'],
	'audacity-normalize': ['libraries/lib-builtin-effects/NormalizeBase.cpp'],
	'audacity-paulstretch': ['libraries/lib-builtin-effects/PaulstretchBase.cpp'],
	'audacity-phaser': ['libraries/lib-builtin-effects/PhaserBase.cpp'],
	'audacity-repair': [
		'libraries/lib-builtin-effects/Repair.cpp',
		'libraries/lib-math/InterpolateAudio.cpp',
	],
	'audacity-remove-dc-offset': ['libraries/lib-builtin-effects/NormalizeBase.cpp'],
	'audacity-reverb': ['au3/libraries/au3-builtin-effects/ReverbBase.cpp'],
	'audacity-repeat': ['libraries/lib-builtin-effects/RepeatBase.cpp'],
	'audacity-reverse': ['libraries/lib-builtin-effects/Reverse.cpp'],
	'audacity-classic-filters': ['libraries/lib-builtin-effects/ScienFilterBase.cpp'],
	'audacity-truncate-silence': ['libraries/lib-builtin-effects/TruncSilenceBase.cpp'],
	'audacity-wahwah': ['libraries/lib-builtin-effects/WahWahBase.cpp'],
});

const GRAPHIC_EQ_FREQUENCIES = Object.freeze([
	20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
	800, 1_000, 1_250, 1_600, 2_000, 2_500, 3_150, 4_000, 5_000, 6_300,
	8_000, 10_000, 12_500, 16_000, 20_000,
]);

const label = (en, de) => ({ en, de });
const number = (en, de, defaultValue, minimum, maximum, options = {}) => ({
	kind: 'number', label: label(en, de), default: defaultValue, minimum, maximum, ...options,
});
const checkbox = (en, de, defaultValue = false) => ({
	kind: 'boolean', label: label(en, de), default: defaultValue,
});
const select = (en, de, defaultValue, options) => ({
	kind: 'enum', label: label(en, de), default: defaultValue, options,
});
const option = (value, en, de) => ({ value, label: label(en, de) });

const definitions = {
	'audacity-amplify': {
		label: label('Amplify', 'Verstärken'),
		category: 'volume',
		params: {
			gainDb: number('Amplification', 'Verstärkung', 0, -50, 50, { unit: 'dB', step: 0.1 }),
			allowClipping: checkbox('Allow clipping', 'Übersteuerung erlauben'),
		},
	},
	'audacity-auto-duck': {
		label: label('Auto Duck', 'Auto-Duck'),
		category: 'volume',
		requiresControlTrack: true,
		params: {
			duckAmountDb: number('Duck amount', 'Absenkung', -12, -24, 0, { unit: 'dB', step: 0.1 }),
			innerFadeDown: number('Inner fade down', 'Innere Abblendzeit', 0, 0, 3, { unit: 's', step: 0.01 }),
			innerFadeUp: number('Inner fade up', 'Innere Aufblendzeit', 0, 0, 3, { unit: 's', step: 0.01 }),
			outerFadeDown: number('Outer fade down', 'Äußere Abblendzeit', 0.5, 0, 3, { unit: 's', step: 0.01 }),
			outerFadeUp: number('Outer fade up', 'Äußere Aufblendzeit', 0.5, 0, 3, { unit: 's', step: 0.01 }),
			thresholdDb: number('Threshold', 'Schwellwert', -30, -100, 0, { unit: 'dB', step: 0.1 }),
			maximumPause: number('Maximum pause', 'Maximale Pause', 1, 0, Number.MAX_VALUE, { unit: 's', step: 0.01 }),
		},
	},
	'audacity-bass-treble': {
		label: label('Bass and Treble', 'Bass und Höhen'),
		category: 'eq',
		params: {
			bassDb: number('Bass', 'Bass', 0, -30, 30, { unit: 'dB', step: 0.1 }),
			trebleDb: number('Treble', 'Höhen', 0, -30, 30, { unit: 'dB', step: 0.1 }),
			volumeDb: number('Volume', 'Lautstärke', 0, -30, 30, { unit: 'dB', step: 0.1 }),
		},
	},
	'audacity-click-removal': {
		label: label('Click Removal', 'Klickentfernung'),
		category: 'repair',
		params: {
			threshold: number('Threshold', 'Schwellwert', 200, 0, 900, { integer: true, step: 1 }),
			maximumWidth: number('Maximum spike width', 'Maximale Klickbreite', 20, 0, 40, { unit: 'samples', integer: true, step: 1 }),
		},
	},
	'audacity-change-pitch': {
		label: label('Change Pitch', 'Tonhöhe ändern'),
		category: 'pitch-tempo',
		requiresStaffPad: true,
		params: {
			semitones: number('Semitones', 'Halbtöne', 0, -12, 12, { unit: 'st', step: 0.01 }),
			preserveFormants: checkbox('Preserve formants', 'Formanten beibehalten', true),
		},
	},
	'audacity-change-tempo': {
		label: label('Change Tempo', 'Tempo ändern'),
		category: 'pitch-tempo',
		lengthChanging: true,
		requiresStaffPad: true,
		params: {
			tempoPercent: number('Percent change', 'Änderung in Prozent', 0, -50, 100, { unit: '%', step: 0.1 }),
		},
	},
	'audacity-change-speed-pitch': {
		label: label('Change Speed and Pitch', 'Geschwindigkeit und Tonhöhe ändern'),
		category: 'pitch-tempo',
		lengthChanging: true,
		requiresStaffPad: true,
		params: {
			speedPercent: number('Speed change', 'Geschwindigkeitsänderung', 0, -50, 100, { unit: '%', step: 0.1 }),
		},
	},
	'audacity-sliding-stretch': {
		label: label('Sliding Stretch', 'Gleitende Dehnung'),
		category: 'pitch-tempo',
		lengthChanging: true,
		requiresStaffPad: true,
		params: {
			startTempoPercent: number('Initial tempo change', 'Anfängliche Tempoänderung', 0, -50, 100, { unit: '%', step: 0.1 }),
			endTempoPercent: number('Final tempo change', 'Abschließende Tempoänderung', 0, -50, 100, { unit: '%', step: 0.1 }),
			startPitchSemitones: number('Initial pitch shift', 'Anfängliche Tonhöhenänderung', 0, -12, 12, { unit: 'st', step: 0.01 }),
			endPitchSemitones: number('Final pitch shift', 'Abschließende Tonhöhenänderung', 0, -12, 12, { unit: 'st', step: 0.01 }),
			preserveFormants: checkbox('Preserve formants', 'Formanten beibehalten', true),
		},
	},
	'audacity-compressor': {
		label: label('Compressor (Audacity)', 'Kompressor (Audacity)'),
		category: 'volume',
		collision: true,
		params: {
			thresholdDb: number('Threshold', 'Schwellwert', -10, -60, 0, { unit: 'dB', step: 0.1 }),
			makeupGainDb: number('Make-up gain', 'Aufholverstärkung', 0, -30, 30, { unit: 'dB', step: 0.1 }),
			kneeWidthDb: number('Knee width', 'Kniebreite', 5, 0, 30, { unit: 'dB', step: 0.1 }),
			ratio: number('Ratio', 'Verhältnis', 10, 1, 100, { step: 0.1 }),
			lookaheadMs: number('Lookahead', 'Lookahead', 1, 0, 1_000, { unit: 'ms', step: 0.1 }),
			attackMs: number('Attack', 'Ansprechzeit', 30, 0, 200, { unit: 'ms', step: 0.1 }),
			releaseMs: number('Release', 'Abklingzeit', 150, 0, 1_000, { unit: 'ms', step: 0.1 }),
		},
	},
	'audacity-legacy-compressor': {
		label: label('Legacy Compressor', 'Legacy-Kompressor'),
		category: 'volume',
		params: {
			thresholdDb: number('Threshold', 'Schwellwert', -12, -60, -1, { unit: 'dB', step: 0.1 }),
			noiseFloorDb: number('Noise floor', 'Grundrauschen', -40, -80, -20, { unit: 'dB', step: 0.1 }),
			ratio: number('Ratio', 'Verhältnis', 2, 1.1, 10, { step: 0.1 }),
			attackSeconds: number('Attack time', 'Ansprechzeit', 0.2, 0.1, 5, { unit: 's', step: 0.01 }),
			releaseSeconds: number('Release time', 'Abklingzeit', 1, 1, 30, { unit: 's', step: 0.1 }),
			normalize: checkbox('Make-up gain to 0 dB', 'Auf 0 dB anheben', true),
			usePeak: checkbox('Compress based on peaks', 'Anhand von Spitzen komprimieren'),
		},
	},
	'audacity-distortion': {
		label: label('Distortion', 'Verzerrung'),
		category: 'special',
		params: {
			mode: select('Distortion type', 'Verzerrungsart', 'hard-clipping', [
				option('hard-clipping', 'Hard Clipping', 'Hartes Clipping'),
				option('soft-clipping', 'Soft Clipping', 'Weiches Clipping'),
				option('soft-overdrive', 'Soft Overdrive', 'Weicher Overdrive'),
				option('medium-overdrive', 'Medium Overdrive', 'Mittlerer Overdrive'),
				option('hard-overdrive', 'Hard Overdrive', 'Harter Overdrive'),
				option('cubic', 'Cubic Curve (odd harmonics)', 'Kubische Kurve (ungerade Obertöne)'),
				option('even-harmonics', 'Even Harmonics', 'Gerade Obertöne'),
				option('expand-compress', 'Expand and Compress', 'Expandieren und komprimieren'),
				option('leveller', 'Leveller', 'Pegelangleicher'),
				option('rectifier', 'Rectifier Distortion', 'Gleichrichter-Verzerrung'),
				option('hard-limiter', 'Hard Limiter 1413', 'Harter Limiter 1413'),
			]),
			dcBlock: checkbox('DC block', 'Gleichspannung sperren'),
			thresholdDb: number('Threshold', 'Schwellwert', -6, -100, 0, { unit: 'dB', step: 0.1 }),
			noiseFloorDb: number('Noise floor', 'Grundrauschen', -70, -80, -20, { unit: 'dB', step: 0.1 }),
			parameter1: number('Parameter 1', 'Parameter 1', 50, 0, 100, { unit: '%', step: 1 }),
			parameter2: number('Parameter 2', 'Parameter 2', 50, 0, 100, { unit: '%', step: 1 }),
			repeats: number('Repeats', 'Wiederholungen', 1, 0, 5, { integer: true, step: 1 }),
		},
	},
	'audacity-echo': {
		label: label('Echo', 'Echo'),
		category: 'delay',
		params: {
			delaySeconds: number('Delay time', 'Verzögerungszeit', 1, 0.001, FLOAT_MAX, { unit: 's', step: 0.001 }),
			decay: number('Decay factor', 'Abklingfaktor', 0.5, 0, FLOAT_MAX, { step: 0.01 }),
		},
	},
	'audacity-fade-in': { label: label('Fade In', 'Einblenden'), category: 'fades', params: {} },
	'audacity-fade-out': { label: label('Fade Out', 'Ausblenden'), category: 'fades', params: {} },
	'audacity-filter-curve-eq': {
		label: label('Filter Curve EQ', 'Filterkurven-EQ'),
		category: 'eq',
		params: {
			points: {
				kind: 'curve', label: label('Curve points (Hz:dB)', 'Kurvenpunkte (Hz:dB)'),
				default: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }],
			},
			linearFrequencyScale: checkbox('Linear frequency scale', 'Lineare Frequenzskala'),
			filterLength: number('FIR filter length', 'FIR-Filterlänge', 8191, 21, 8191, { integer: true, odd: true, step: 2 }),
		},
	},
	'audacity-graphic-eq': {
		label: label('Graphic EQ', 'Grafischer EQ'),
		category: 'eq',
		params: {
			gains: { kind: 'bands', label: label('Third-octave bands', 'Terzbänder'), frequencies: GRAPHIC_EQ_FREQUENCIES, default: GRAPHIC_EQ_FREQUENCIES.map(() => 0), minimum: -20, maximum: 20, step: 0.5, unit: 'dB' },
			interpolation: select('Interpolation', 'Interpolation', 'bspline', [
				option('bspline', 'B-spline', 'B-Spline'), option('cosine', 'Cosine', 'Kosinus'), option('cubic', 'Cubic', 'Kubisch'),
			]),
			filterLength: number('FIR filter length', 'FIR-Filterlänge', 8191, 21, 8191, { integer: true, odd: true, step: 2 }),
		},
	},
	'audacity-invert': { label: label('Invert', 'Invertieren'), category: 'special', params: {} },
	'audacity-limiter': {
		label: label('Limiter (Audacity)', 'Limiter (Audacity)'),
		category: 'volume',
		collision: true,
		params: {
			thresholdDb: number('Threshold', 'Schwellwert', -5, -30, 0, { unit: 'dB', step: 0.1 }),
			makeupTargetDb: number('Make-up target', 'Aufholziel', -1, -30, 0, { unit: 'dB', step: 0.1 }),
			kneeWidthDb: number('Knee width', 'Kniebreite', 2, 0, 10, { unit: 'dB', step: 0.1 }),
			lookaheadMs: number('Lookahead', 'Lookahead', 1, 0, 50, { unit: 'ms', step: 0.1 }),
			releaseMs: number('Release', 'Abklingzeit', 20, 0, 1_000, { unit: 'ms', step: 0.1 }),
		},
	},
	'audacity-loudness-normalization': {
		label: label('Loudness Normalization', 'Lautheitsnormalisierung'),
		category: 'volume',
		params: {
			mode: select('Normalize', 'Normalisieren', 'lufs', [option('lufs', 'Perceived loudness', 'Wahrgenommene Lautheit'), option('rms', 'RMS', 'RMS')]),
			targetLufs: number('Target loudness', 'Ziellautheit', -23, -145, 0, { unit: 'LUFS', step: 0.1 }),
			targetRmsDb: number('Target RMS', 'Ziel-RMS', -20, -145, 0, { unit: 'dB', step: 0.1 }),
			stereoIndependent: checkbox('Normalize stereo channels independently', 'Stereokanäle getrennt normalisieren'),
			dualMono: checkbox('Treat mono as dual-mono', 'Mono als Dual-Mono behandeln', true),
		},
	},
	'audacity-noise-reduction': {
		label: label('Noise Reduction', 'Rauschverminderung'),
		category: 'repair',
		requiresNoiseProfile: true,
		params: {
			reductionDb: number('Noise reduction', 'Rauschverminderung', 6, 0, 48, { unit: 'dB', step: 0.1 }),
			sensitivity: number('Sensitivity', 'Empfindlichkeit', 6, 0.01, 24, { step: 0.01 }),
			frequencySmoothingBands: number('Frequency smoothing', 'Frequenzglättung', 6, 0, 12, { unit: 'bands', integer: true, step: 1 }),
			output: select('Output', 'Ausgabe', 'reduce', [option('reduce', 'Reduce noise', 'Rauschen vermindern'), option('residue', 'Residue', 'Restrauschen')]),
		},
	},
	'audacity-normalize': {
		label: label('Normalize', 'Normalisieren'),
		category: 'volume',
		params: {
			peakDb: number('Peak amplitude', 'Spitzenamplitude', -1, -145, 0, { unit: 'dBFS', step: 0.1 }),
			removeDc: checkbox('Remove DC offset', 'Gleichspannungsversatz entfernen', true),
			applyGain: checkbox('Normalize peak amplitude', 'Spitzenamplitude normalisieren', true),
			stereoIndependent: checkbox('Normalize stereo channels independently', 'Stereokanäle getrennt normalisieren'),
		},
	},
	'audacity-paulstretch': {
		label: label('Paulstretch', 'Paulstretch'),
		category: 'special',
		lengthChanging: true,
		params: {
			stretchFactor: number('Stretch factor', 'Streckfaktor', 10, 1, FLOAT_MAX, { step: 0.01 }),
			timeResolution: number('Time resolution', 'Zeitauflösung', 0.25, 0.00099, FLOAT_MAX, { unit: 's', step: 0.001 }),
		},
	},
	'audacity-phaser': {
		label: label('Phaser', 'Phaser'),
		category: 'modulation',
		params: {
			stages: number('Stages', 'Stufen', 2, 2, 24, { integer: true, even: true, step: 2 }),
			dryWet: number('Dry/wet', 'Trocken/Nass', 128, 0, 255, { integer: true, step: 1 }),
			frequency: number('LFO frequency', 'LFO-Frequenz', 0.4, 0.001, 4, { unit: 'Hz', step: 0.001 }),
			phaseDegrees: number('Starting phase', 'Startphase', 0, 0, 360, { unit: '°', step: 0.1 }),
			depth: number('Depth', 'Tiefe', 100, 0, 255, { integer: true, step: 1 }),
			feedbackPercent: number('Feedback', 'Rückkopplung', 0, -100, 100, { unit: '%', integer: true, step: 1 }),
			outputGainDb: number('Output gain', 'Ausgangsverstärkung', -6, -30, 30, { unit: 'dB', step: 0.1 }),
		},
	},
	'audacity-repair': { label: label('Repair', 'Reparieren'), category: 'repair', requiresContext: true, params: {} },
	'audacity-remove-dc-offset': { label: label('Remove DC Offset', 'Gleichspannungsversatz entfernen'), category: 'repair', params: {} },
	'audacity-reverb': {
		label: label('Reverb', 'Hall'),
		category: 'delay',
		browserAdaptation: 'schroeder',
		params: {
			roomSize: number('Room size', 'Raumgröße', 75, 0, 100, { unit: '%', step: 1 }),
			reverberance: number('Reverberance', 'Halligkeit', 50, 0, 100, { unit: '%', step: 1 }),
			damping: number('Damping', 'Dämpfung', 50, 0, 100, { unit: '%', step: 1 }),
			wetGainDb: number('Wet gain', 'Effektpegel', -6, -60, 12, { unit: 'dB', step: 0.1 }),
			dryGainDb: number('Dry gain', 'Direktpegel', 0, -60, 12, { unit: 'dB', step: 0.1 }),
			stereoWidth: number('Stereo width', 'Stereobreite', 100, 0, 100, { unit: '%', step: 1 }),
			wetOnly: checkbox('Wet only', 'Nur Effekt'),
		},
	},
	'audacity-repeat': {
		label: label('Repeat', 'Wiederholen'), category: 'special', lengthChanging: true,
		params: { count: number('Number of repeats', 'Anzahl Wiederholungen', 1, 1, 2_147_483_647, { integer: true, step: 1 }) },
	},
	'audacity-reverse': { label: label('Reverse', 'Rückwärts'), category: 'special', params: {} },
	'audacity-classic-filters': {
		label: label('Classic Filters', 'Klassische Filter'),
		category: 'eq',
		params: {
			family: select('Filter family', 'Filterfamilie', 'butterworth', [option('butterworth', 'Butterworth', 'Butterworth'), option('chebyshev-i', 'Chebyshev Type I', 'Tschebyscheff Typ I'), option('chebyshev-ii', 'Chebyshev Type II', 'Tschebyscheff Typ II')]),
			direction: select('Filter type', 'Filtertyp', 'lowpass', [option('lowpass', 'Low-pass', 'Tiefpass'), option('highpass', 'High-pass', 'Hochpass')]),
			order: number('Order', 'Ordnung', 1, 1, 10, { integer: true, step: 1 }),
			cutoffHz: number('Cutoff frequency', 'Grenzfrequenz', 1_000, 1, 23_999, { unit: 'Hz', step: 1 }),
			passbandRippleDb: number('Passband ripple', 'Durchlasswelligkeit', 1, 0, 100, { unit: 'dB', step: 0.1 }),
			stopbandAttenuationDb: number('Stopband attenuation', 'Sperrdämpfung', 30, 0, 100, { unit: 'dB', step: 0.1 }),
		},
	},
	'audacity-truncate-silence': {
		label: label('Truncate Silence', 'Stille kürzen'),
		category: 'special',
		lengthChanging: true,
		// Audacity's Independent setting coordinates processing across multiple
		// selected tracks. Selection effects here target one track, making it inert.
		params: {
			thresholdDb: number('Threshold', 'Schwellwert', -20, -80, -20, { unit: 'dB', step: 0.1 }),
			action: select('Action', 'Aktion', 'truncate', [option('truncate', 'Truncate detected silence', 'Erkannte Stille kürzen'), option('compress', 'Compress excess silence', 'Überschüssige Stille komprimieren')]),
			minimumSilence: number('Minimum silence', 'Minimale Stille', 0.5, 0.001, 10_000, { unit: 's', step: 0.001 }),
			truncateTo: number('Truncate to', 'Kürzen auf', 0.5, 0, 10_000, { unit: 's', step: 0.001 }),
			compressPercent: number('Compress to', 'Komprimieren auf', 50, 0, 99.9, { unit: '%', step: 0.1 }),
		},
	},
	'audacity-wahwah': {
		label: label('Wahwah', 'Wahwah'),
		category: 'modulation',
		params: {
			frequency: number('LFO frequency', 'LFO-Frequenz', 1.5, 0.1, 4, { unit: 'Hz', step: 0.01 }),
			phaseDegrees: number('Starting phase', 'Startphase', 0, 0, 360, { unit: '°', step: 0.1 }),
			depthPercent: number('Depth', 'Tiefe', 70, 0, 100, { unit: '%', integer: true, step: 1 }),
			resonance: number('Resonance', 'Resonanz', 2.5, 0.1, 10, { step: 0.1 }),
			frequencyOffsetPercent: number('Frequency offset', 'Frequenzversatz', 30, 0, 100, { unit: '%', integer: true, step: 1 }),
			outputGainDb: number('Output gain', 'Ausgangsverstärkung', -6, -30, 30, { unit: 'dB', step: 0.1 }),
		},
	},
};

export const AUDACITY_EFFECT_DEFINITIONS = deepFreeze(definitions);

export const AUDACITY_EFFECT_EXCLUSIONS = deepFreeze([]);

// Native Audacity modules which are deliberately outside the menu-visible
// processing-effect inventory: generators and analyzers are different editor
// operations, while Stereo To Mono is a hidden command in Audacity 3.7.7.
export const AUDACITY_NON_PROCESS_MODULES = deepFreeze({
	DTMF: 'generate',
	Chirp: 'generate',
	Noise: 'generate',
	Silence: 'generate',
	Tone: 'generate',
	'Find Clipping': 'analyze',
	'Stereo To Mono': 'hidden',
});

export function audacityEffectTypes() {
	return Object.keys(AUDACITY_EFFECT_DEFINITIONS);
}

export function audacityEffectLabel(type, locale = 'en') {
	const definition = requireDefinition(type);
	return localized(definition.label, locale);
}

export function audacityEffectDefaults(type) {
	const definition = requireDefinition(type);
	return Object.fromEntries(Object.entries(definition.params).map(([name, descriptor]) => [name, clone(descriptor.default)]));
}

export function normalizeAudacityEffectParams(type, values = {}) {
	const definition = requireDefinition(type);
	const output = {};
	for (const [name, descriptor] of Object.entries(definition.params)) {
		const value = values[name] ?? clone(descriptor.default);
		if (descriptor.kind === 'number') output[name] = normalizeNumber(value, descriptor, `${type}.${name}`);
		else if (descriptor.kind === 'boolean') output[name] = normalizeBoolean(value);
		else if (descriptor.kind === 'enum') output[name] = normalizeEnum(value, descriptor, `${type}.${name}`);
		else if (descriptor.kind === 'curve') output[name] = normalizeCurve(value, `${type}.${name}`);
		else if (descriptor.kind === 'bands') output[name] = normalizeBands(value, descriptor, `${type}.${name}`);
	}
	return output;
}

export function formatAudacityCurve(points) {
	return normalizeCurve(points, 'curve').map((point) => `${point.frequency}:${point.gain}`).join(', ');
}

export function parseAudacityCurve(value) {
	if (Array.isArray(value)) return normalizeCurve(value, 'curve');
	const points = String(value || '').split(/[;,\n]+/).filter((part) => part.trim()).map((part) => {
		const [frequency, gain] = part.trim().split(/\s*:\s*|\s+/).map(Number);
		return { frequency, gain };
	});
	return normalizeCurve(points, 'curve');
}

export function localized(value, locale = 'en') {
	return value?.[locale === 'de' ? 'de' : 'en'] ?? value?.en ?? String(value ?? '');
}

function requireDefinition(type) {
	const definition = AUDACITY_EFFECT_DEFINITIONS[type];
	if (!definition) throw new RangeError(`Unsupported Audacity effect: ${type}.`);
	return definition;
}

function normalizeNumber(value, descriptor, name) {
	let result = Number(value);
	if (!Number.isFinite(result) || result < descriptor.minimum || result > descriptor.maximum) {
		throw new RangeError(`${name} must be between ${descriptor.minimum} and ${descriptor.maximum}.`);
	}
	if (descriptor.integer) result = Math.round(result);
	if (descriptor.odd && result % 2 === 0) result += result < descriptor.maximum ? 1 : -1;
	// PhaserBase clears the low bit (mStages &= ~1), so odd stage counts are
	// coerced to the preceding even value rather than rounded upward.
	if (descriptor.even && result % 2 !== 0) result -= 1;
	return result;
}

function normalizeBoolean(value) {
	if (typeof value === 'string') return value === 'true' || value === '1' || value === 'on';
	return Boolean(value);
}

function normalizeEnum(value, descriptor, name) {
	const match = descriptor.options.find((item) => String(item.value) === String(value));
	if (!match) throw new RangeError(`${name} is not a supported option.`);
	return match.value;
}

function normalizeCurve(value, name) {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array of curve points.`);
	const points = value.map((point, index) => {
		const frequency = Number(point?.frequency);
		const gain = Number(point?.gain);
		if (!Number.isFinite(frequency) || frequency < 1 || frequency > 24_000) throw new RangeError(`${name}[${index}].frequency must be between 1 and 24000.`);
		if (!Number.isFinite(gain) || gain < -120 || gain > 60) throw new RangeError(`${name}[${index}].gain must be between -120 and 60.`);
		return { frequency, gain };
	}).sort((left, right) => left.frequency - right.frequency);
	for (let index = 1; index < points.length; index += 1) {
		if (points[index].frequency === points[index - 1].frequency) throw new RangeError(`${name} frequencies must be unique.`);
	}
	return points;
}

function normalizeBands(value, descriptor, name) {
	if (!Array.isArray(value) || value.length !== descriptor.frequencies.length) {
		throw new RangeError(`${name} requires ${descriptor.frequencies.length} band gains.`);
	}
	return value.map((gain, index) => {
		const numberValue = Number(gain);
		if (!Number.isFinite(numberValue) || numberValue < descriptor.minimum || numberValue > descriptor.maximum) {
			throw new RangeError(`${name}[${index}] must be between ${descriptor.minimum} and ${descriptor.maximum}.`);
		}
		return numberValue;
	});
}

function clone(value) {
	if (value == null || typeof value !== 'object') return value;
	return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
