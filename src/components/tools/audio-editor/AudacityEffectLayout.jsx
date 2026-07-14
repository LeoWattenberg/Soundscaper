import React from 'react';

const CARD_TITLES = Object.freeze({
	'Amplification': { en: 'Amplification', de: 'Verstärkung' },
	'Ducking': { en: 'Ducking', de: 'Absenkung' },
	'Fade down': { en: 'Fade down', de: 'Abblenden' },
	'Fade up': { en: 'Fade up', de: 'Aufblenden' },
	'Tone': { en: 'Tone', de: 'Klang' },
	'Output': { en: 'Output', de: 'Ausgabe' },
	'Click detection': { en: 'Click detection', de: 'Klickerkennung' },
	'Pitch shift': { en: 'Pitch shift', de: 'Tonhöhenänderung' },
	'Quality': { en: 'Quality', de: 'Qualität' },
	'Tempo change': { en: 'Tempo change', de: 'Tempoänderung' },
	'Speed and pitch': { en: 'Speed and pitch', de: 'Geschwindigkeit und Tonhöhe' },
	'Initial tempo change': { en: 'Initial tempo change', de: 'Anfängliche Tempoänderung' },
	'Final tempo change': { en: 'Final tempo change', de: 'Abschließende Tempoänderung' },
	'Initial pitch shift': { en: 'Initial pitch shift', de: 'Anfängliche Tonhöhenänderung' },
	'Final pitch shift': { en: 'Final pitch shift', de: 'Abschließende Tonhöhenänderung' },
	'General': { en: 'General', de: 'Allgemein' },
	'Timing': { en: 'Timing', de: 'Zeitverhalten' },
	'Compression': { en: 'Compression', de: 'Kompression' },
	'Response': { en: 'Response', de: 'Kennlinie' },
	'Mode': { en: 'Mode', de: 'Modus' },
	'Drive': { en: 'Drive', de: 'Ansteuerung' },
	'Texture': { en: 'Texture', de: 'Textur' },
	'Echo': { en: 'Echo', de: 'Echo' },
	'Equalization curve': { en: 'Equalization curve', de: 'Equalizer-Kurve' },
	'Display': { en: 'Display', de: 'Anzeige' },
	'Filter': { en: 'Filter', de: 'Filter' },
	'Third-octave bands': { en: 'Third-octave bands', de: 'Terzbänder' },
	'Settings': { en: 'Settings', de: 'Einstellungen' },
	'Level': { en: 'Level', de: 'Pegel' },
	'Character': { en: 'Character', de: 'Charakter' },
	'Target loudness': { en: 'Target loudness', de: 'Ziellautheit' },
	'Channels': { en: 'Channels', de: 'Kanäle' },
	'Step 2 · Noise reduction': { en: 'Step 2 · Noise reduction', de: 'Schritt 2 · Rauschverminderung' },
	'Normalize': { en: 'Normalize', de: 'Normalisieren' },
	'Stretch': { en: 'Stretch', de: 'Dehnung' },
	'Resolution': { en: 'Resolution', de: 'Auflösung' },
	'Sweep': { en: 'Sweep', de: 'Modulation' },
	'Space': { en: 'Space', de: 'Raum' },
	'Mix': { en: 'Mix', de: 'Mischung' },
	'Repeat': { en: 'Repeat', de: 'Wiederholen' },
	'Detect silence': { en: 'Detect silence', de: 'Stille erkennen' },
	'Action': { en: 'Action', de: 'Aktion' },
	'High-pass filter': { en: 'High-pass filter', de: 'Hochpassfilter' },
	'Low-pass filter': { en: 'Low-pass filter', de: 'Tiefpassfilter' },
	'Equalizer bands': { en: 'Equalizer bands', de: 'Equalizer-Bänder' },
	'Limiter': { en: 'Limiter', de: 'Limiter' },
	'Detection': { en: 'Detection', de: 'Erkennung' },
	'Envelope': { en: 'Envelope', de: 'Hüllkurve' },
	'Delay': { en: 'Delay', de: 'Verzögerung' },
});

const EFFECT_LAYOUTS = Object.freeze({
	'audacity-amplify': [
		{ title: 'Amplification', names: ['gainDb', 'allowClipping'], wide: true },
	],
	'audacity-auto-duck': [
		{ title: 'Ducking', names: ['duckAmountDb', 'thresholdDb', 'maximumPause'], wide: true },
		{ title: 'Fade down', names: ['outerFadeDown', 'innerFadeDown'] },
		{ title: 'Fade up', names: ['innerFadeUp', 'outerFadeUp'] },
	],
	'audacity-bass-treble': [
		{ title: 'Tone', names: ['bassDb', 'trebleDb'], knobs: true },
		{ title: 'Output', names: ['volumeDb'], knobs: true },
	],
	'audacity-click-removal': [
		{ title: 'Click detection', names: ['threshold', 'maximumWidth'], wide: true },
	],
	'audacity-change-pitch': [
		{ title: 'Pitch shift', names: ['semitones'], knobs: true },
		{ title: 'Quality', names: ['preserveFormants'] },
	],
	'audacity-change-tempo': [
		{ title: 'Tempo change', names: ['tempoPercent'], wide: true },
	],
	'audacity-change-speed-pitch': [
		{ title: 'Speed and pitch', names: ['speedPercent'], wide: true },
	],
	'audacity-sliding-stretch': [
		{ title: 'Initial tempo change', names: ['startTempoPercent'] },
		{ title: 'Final tempo change', names: ['endTempoPercent'] },
		{ title: 'Initial pitch shift', names: ['startPitchSemitones'] },
		{ title: 'Final pitch shift', names: ['endPitchSemitones'] },
		{ title: 'General', names: ['preserveFormants'], wide: true },
	],
	'audacity-compressor': [
		{ title: 'Timing', names: ['attackMs', 'releaseMs', 'lookaheadMs'], knobs: true },
		{ title: 'Compression', names: ['thresholdDb', 'ratio', 'kneeWidthDb', 'makeupGainDb'], knobs: true },
		{ title: 'Response', names: [], response: 'compressor', wide: true },
	],
	'audacity-legacy-compressor': [
		{ title: 'Compression', names: ['thresholdDb', 'noiseFloorDb', 'ratio'], knobs: true },
		{ title: 'Timing', names: ['attackSeconds', 'releaseSeconds'], knobs: true },
		{ title: 'Output', names: ['normalize', 'usePeak'], wide: true },
		{ title: 'Response', names: [], response: 'compressor', wide: true },
	],
	'audacity-distortion': [
		{ title: 'Mode', names: ['mode', 'dcBlock'], wide: true },
		{ title: 'Drive', names: ['thresholdDb', 'noiseFloorDb', 'parameter1', 'parameter2'], knobs: true },
		{ title: 'Texture', names: ['repeats'] },
	],
	'audacity-echo': [
		{ title: 'Echo', names: ['delaySeconds', 'decay'], knobs: true, wide: true },
	],
	'audacity-filter-curve-eq': [
		{ title: 'Equalization curve', names: ['points'], wide: true },
		{ title: 'Display', names: ['linearFrequencyScale'] },
		{ title: 'Filter', names: ['filterLength'] },
	],
	'audacity-graphic-eq': [
		{ title: 'Third-octave bands', names: ['gains'], wide: true },
		{ title: 'Settings', names: ['interpolation', 'filterLength'], wide: true },
	],
	'audacity-limiter': [
		{ title: 'Level', names: ['thresholdDb', 'makeupTargetDb'], knobs: true },
		{ title: 'Character', names: ['lookaheadMs', 'kneeWidthDb', 'releaseMs'], knobs: true },
		{ title: 'Response', names: [], response: 'limiter', wide: true },
	],
	'audacity-loudness-normalization': [
		{ title: 'Target loudness', names: ['mode', 'targetLufs', 'targetRmsDb'], wide: true },
		{ title: 'Channels', names: ['stereoIndependent', 'dualMono'], wide: true },
	],
	'audacity-noise-reduction': [
		{ title: 'Step 2 · Noise reduction', names: ['reductionDb', 'sensitivity', 'frequencySmoothingBands'], wide: true },
		{ title: 'Output', names: ['output'], wide: true },
	],
	'audacity-normalize': [
		{ title: 'Normalize', names: ['removeDc', 'applyGain', 'peakDb', 'stereoIndependent'], wide: true },
	],
	'audacity-paulstretch': [
		{ title: 'Stretch', names: ['stretchFactor'] },
		{ title: 'Resolution', names: ['timeResolution'] },
	],
	'audacity-phaser': [
		{ title: 'Sweep', names: ['stages', 'frequency', 'phaseDegrees', 'depth'], knobs: true },
		{ title: 'Mix', names: ['dryWet', 'feedbackPercent', 'outputGainDb'], knobs: true },
	],
	'audacity-reverb': [
		{ title: 'Space', names: ['roomSize', 'stereoWidth'], knobs: true },
		{ title: 'Tone', names: ['damping', 'reverberance'], knobs: true },
		{ title: 'Mix', names: ['wetGainDb', 'dryGainDb', 'wetOnly'], knobs: true, wide: true },
	],
	'audacity-repeat': [
		{ title: 'Repeat', names: ['count'], wide: true },
	],
	'audacity-classic-filters': [
		{ title: 'Filter', names: ['family', 'direction', 'order', 'cutoffHz'], wide: true },
		{ title: 'Response', names: ['passbandRippleDb', 'stopbandAttenuationDb'], response: 'filter', wide: true },
	],
	'audacity-truncate-silence': [
		{ title: 'Detect silence', names: ['thresholdDb', 'minimumSilence'], wide: true },
		{ title: 'Action', names: ['action', 'truncateTo', 'compressPercent'], wide: true },
	],
	'audacity-wahwah': [
		{ title: 'Sweep', names: ['frequency', 'phaseDegrees', 'depthPercent', 'frequencyOffsetPercent'], knobs: true },
		{ title: 'Character', names: ['resonance', 'outputGainDb'], knobs: true },
	],
	highpass: [
		{ title: 'High-pass filter', names: ['frequency', 'q'], response: 'highpass', wide: true },
	],
	lowpass: [
		{ title: 'Low-pass filter', names: ['frequency', 'q'], response: 'lowpass', wide: true },
	],
	eq: [
		{ title: 'Equalizer bands', names: ['bands'], response: 'equalizer', wide: true },
	],
	compressor: [
		{ title: 'Compression', names: ['threshold', 'knee', 'ratio', 'makeupGain'], knobs: true },
		{ title: 'Timing', names: ['attack', 'release'], knobs: true },
		{ title: 'Response', names: [], response: 'compressor', wide: true },
	],
	limiter: [
		{ title: 'Limiter', names: ['ceiling', 'lookahead', 'release'], knobs: true },
		{ title: 'Response', names: [], response: 'limiter', wide: true },
	],
	gate: [
		{ title: 'Detection', names: ['threshold', 'rangeDb'], knobs: true },
		{ title: 'Envelope', names: ['attack', 'hold', 'release'], knobs: true },
		{ title: 'Response', names: [], response: 'gate', wide: true },
	],
	reverb: [
		{ title: 'Space', names: ['decay', 'preDelay'], knobs: true },
		{ title: 'Mix', names: ['mix'], knobs: true },
	],
	delay: [
		{ title: 'Delay', names: ['time', 'feedback', 'mix'], knobs: true, wide: true },
	],
});

const RESPONSE_PATHS = Object.freeze({
	compressor: 'M8 10 H82 C100 10 106 14 116 27 L160 64 H232',
	limiter: 'M8 10 H96 C108 10 112 17 112 30 V64 H232',
	filter: 'M8 58 C40 58 64 56 86 44 C108 32 126 14 150 12 H232',
	highpass: 'M8 62 C50 62 70 58 88 38 C102 21 116 12 144 10 H232',
	lowpass: 'M8 10 H100 C128 10 142 20 156 38 C172 58 192 62 232 62',
	'equalizer': 'M8 36 C30 36 42 18 64 18 C86 18 94 52 118 52 C144 52 152 24 178 24 C198 24 212 36 232 36',
	'graphic-eq': 'M8 38 L24 38 L24 28 L40 28 L40 46 L56 46 L56 16 L72 16 L72 34 L88 34 L88 54 L104 54 L104 44 L120 44 L120 20 L136 20 L136 30 L152 30 L152 14 L168 14 L168 40 L184 40 L184 26 L200 26 L200 36 H232',
	gate: 'M8 62 H76 L116 10 H232',
});

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, Number(value)));
}

function sampledPath(sample, count = 48) {
	return Array.from({ length: count + 1 }, (_, index) => {
		const progress = index / count;
		const point = sample(progress);
		return `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
	}).join(' ');
}

function dynamicsResponsePath(type, parameters) {
	const threshold = clamp(parameters.thresholdDb ?? parameters.threshold ?? parameters.ceiling ?? -24, -100, 0);
	const ratio = Math.max(1, Number(parameters.ratio) || (type === 'limiter' ? 100 : 4));
	const makeup = Number(parameters.makeupGainDb ?? parameters.makeupGain ?? 0) || 0;
	const limiterTarget = Number(parameters.makeupTargetDb ?? parameters.ceiling ?? threshold);
	const rangeDb = Math.min(0, Number(parameters.rangeDb ?? -80) || -80);
	return sampledPath((progress) => {
		const input = -100 + progress * 100;
		let output;
		if (type === 'gate') output = input < threshold ? input + rangeDb : input;
		else if (type === 'limiter') output = Math.min(input, threshold) + limiterTarget - threshold;
		else output = (input <= threshold ? input : threshold + (input - threshold) / ratio) + makeup;
		return {
			x: 8 + progress * 224,
			y: 62 - (clamp(output, -100, 0) + 100) / 100 * 52,
		};
	});
}

function filterResponsePath(type, parameters) {
	const direction = type === 'filter' ? parameters.direction || 'lowpass' : type;
	const cutoff = clamp(parameters.cutoffHz ?? parameters.frequency ?? 1_000, 20, 20_000);
	const order = clamp(parameters.order ?? 2, 1, 10);
	const q = clamp(parameters.q ?? 0.707, 0.1, 30);
	return sampledPath((progress) => {
		const frequency = 20 * 1_000 ** progress;
		const octaves = Math.log2(frequency / cutoff);
		const rejectedOctaves = direction === 'highpass' ? Math.max(0, -octaves) : Math.max(0, octaves);
		const resonance = Math.max(0, q - 0.707) * 2.5 * Math.exp(-((octaves / 0.28) ** 2));
		const gain = clamp(-12 * order * rejectedOctaves + resonance, -60, 12);
		return { x: 8 + progress * 224, y: 10 + (12 - gain) / 72 * 52 };
	});
}

function equalizerResponsePath(parameters) {
	const bands = Array.isArray(parameters.bands) ? parameters.bands : [];
	return sampledPath((progress) => {
		const frequency = 20 * 1_000 ** progress;
		const gain = bands.reduce((total, band) => {
			const center = clamp(band.frequency ?? 1_000, 20, 20_000);
			const q = clamp(band.q ?? 1, 0.1, 30);
			const distance = Math.log2(frequency / center);
			const width = Math.max(0.08, 1 / Math.sqrt(q));
			return total + (Number(band.gain) || 0) * Math.exp(-0.5 * (distance / width) ** 2);
		}, 0);
		return { x: 8 + progress * 224, y: 36 - clamp(gain, -24, 24) / 24 * 24 };
	});
}

function responsePath(type, parameters = {}) {
	if (['compressor', 'limiter', 'gate'].includes(type)) return dynamicsResponsePath(type, parameters);
	if (['filter', 'highpass', 'lowpass'].includes(type)) return filterResponsePath(type, parameters);
	if (type === 'equalizer') return equalizerResponsePath(parameters);
	return RESPONSE_PATHS[type] || RESPONSE_PATHS.equalizer;
}

function layoutGroups(effectType, parameterNames) {
	const available = new Set(parameterNames);
	const assigned = new Set();
	const groups = [];

	for (const group of EFFECT_LAYOUTS[effectType] || []) {
		const names = [];
		for (const name of group.names) {
			if (!available.has(name) || assigned.has(name)) continue;
			assigned.add(name);
			names.push(name);
		}
		if (names.length || group.response) groups.push({ ...group, names });
	}

	const remaining = parameterNames.filter((name) => !assigned.has(name));
	if (remaining.length) groups.push({ title: 'Settings', names: remaining, wide: true });
	return groups;
}

function localizedCardTitle(title, locale) {
	const value = CARD_TITLES[title];
	return value?.[locale === 'de' ? 'de' : 'en'] || value?.en || title;
}

function ResponsePanel({ type, parameters }) {
	const path = responsePath(type, parameters);
	return (
		<div className="audio-editor-audacity-layout__response" aria-hidden="true">
			<svg viewBox="0 0 240 72" preserveAspectRatio="none" focusable="false">
				<g className="audio-editor-audacity-layout__response-grid" fill="none" stroke="currentColor" opacity="0.16">
					<path d="M8 10 H232 M8 36 H232 M8 62 H232" />
					<path d="M8 10 V62 M64 10 V62 M120 10 V62 M176 10 V62 M232 10 V62" />
				</g>
				<path
					className="audio-editor-audacity-layout__response-curve"
					d={path}
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
				/>
			</svg>
		</div>
	);
}

/**
 * Audacity-shaped grouping for an editor-owned parameter renderer.
 * Every key in definition.params is passed to renderParameter exactly once.
 */
export function AudacityEffectLayout({
	effectType,
	definition,
	parameters = {},
	renderParameter,
	before = null,
	after = null,
	locale = 'en',
}) {
	const parameterNames = Object.keys(definition?.params || {});
	const groups = layoutGroups(effectType, parameterNames);
	const effectClass = String(effectType || 'effect').replace(/[^a-z0-9_-]+/gi, '-');

	return (
		<div
			className={`audio-editor-audacity-layout audio-editor-audacity-layout--${effectClass}`}
			data-audacity-effect-layout={effectType || ''}
		>
			{before}
			<div className="audio-editor-audacity-layout__grid">
				{groups.map((group, groupIndex) => {
					const className = [
						'audio-editor-audacity-layout__card',
						group.wide && 'audio-editor-audacity-layout__card--wide',
						group.knobs && 'audio-editor-audacity-layout__card--knobs',
					].filter(Boolean).join(' ');
					return (
						<section className={className} key={`${group.title}-${groupIndex}`}>
							<h3 className="audio-editor-audacity-layout__heading">
								{localizedCardTitle(group.title, locale)}
							</h3>
							{group.names.length > 0 && (
								<div className="audio-editor-audacity-layout__parameters">
									{group.names.map((name) => (
										<div
											className="audio-editor-audacity-layout__parameter"
											data-audacity-parameter={name}
											key={name}
										>
											{renderParameter(name)}
										</div>
									))}
								</div>
							)}
							{group.response && <ResponsePanel type={group.response} parameters={parameters} />}
						</section>
					);
				})}
			</div>
			{after}
		</div>
	);
}
