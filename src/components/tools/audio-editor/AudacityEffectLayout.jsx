import React from 'react';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';

const EFFECT_LAYOUTS = Object.freeze({
	'audacity-amplify': [
		{ titleKey: 'effectCardAmplification', names: ['gainDb', 'allowClipping'], wide: true },
	],
	'audacity-auto-duck': [
		{ titleKey: 'effectCardDucking', names: ['duckAmountDb', 'thresholdDb', 'maximumPause'], wide: true },
		{ titleKey: 'effectCardFadeDown', names: ['outerFadeDown', 'innerFadeDown'] },
		{ titleKey: 'effectCardFadeUp', names: ['innerFadeUp', 'outerFadeUp'] },
	],
	'audacity-bass-treble': [
		{ titleKey: 'effectCardTone', names: ['bassDb', 'trebleDb'], knobs: true },
		{ titleKey: 'effectCardOutput', names: ['volumeDb'], knobs: true },
	],
	'audacity-click-removal': [
		{ titleKey: 'effectCardClickDetection', names: ['threshold', 'maximumWidth'], wide: true },
	],
	'audacity-change-pitch': [
		{ titleKey: 'effectCardPitchShift', names: ['semitones'], knobs: true },
		{ titleKey: 'effectCardQuality', names: ['preserveFormants'] },
	],
	'audacity-change-tempo': [
		{ titleKey: 'effectCardTempoChange', names: ['tempoPercent'], wide: true },
	],
	'audacity-change-speed-pitch': [
		{ titleKey: 'effectCardSpeedAndPitch', names: ['speedPercent'], wide: true },
	],
	'audacity-sliding-stretch': [
		{ titleKey: 'effectCardInitialTempoChange', names: ['startTempoPercent'] },
		{ titleKey: 'effectCardFinalTempoChange', names: ['endTempoPercent'] },
		{ titleKey: 'effectCardInitialPitchShift', names: ['startPitchSemitones'] },
		{ titleKey: 'effectCardFinalPitchShift', names: ['endPitchSemitones'] },
		{ titleKey: 'effectCardGeneral', names: ['preserveFormants'], wide: true },
	],
	'audacity-compressor': [
		{ titleKey: 'effectCardTiming', names: ['attackMs', 'releaseMs', 'lookaheadMs'], knobs: true },
		{ titleKey: 'effectCardCompression', names: ['thresholdDb', 'ratio', 'kneeWidthDb', 'makeupGainDb'], knobs: true },
		{ titleKey: 'effectCardResponse', names: [], response: 'compressor', wide: true },
	],
	'audacity-legacy-compressor': [
		{ titleKey: 'effectCardCompression', names: ['thresholdDb', 'noiseFloorDb', 'ratio'], knobs: true },
		{ titleKey: 'effectCardTiming', names: ['attackSeconds', 'releaseSeconds'], knobs: true },
		{ titleKey: 'effectCardOutput', names: ['normalize', 'usePeak'], wide: true },
		{ titleKey: 'effectCardResponse', names: [], response: 'compressor', wide: true },
	],
	'audacity-distortion': [
		{ titleKey: 'effectCardMode', names: ['mode', 'dcBlock'], wide: true },
		{ titleKey: 'effectCardDrive', names: ['thresholdDb', 'noiseFloorDb', 'parameter1', 'parameter2'], knobs: true },
		{ titleKey: 'effectCardTexture', names: ['repeats'] },
	],
	'audacity-echo': [
		{ titleKey: 'effectCardEcho', names: ['delaySeconds', 'decay'], knobs: true, wide: true },
	],
	'audacity-filter-curve-eq': [
		{ titleKey: 'effectCardEqualizationCurve', names: ['points'], wide: true },
		{ titleKey: 'effectCardDisplay', names: ['linearFrequencyScale'] },
		{ titleKey: 'effectCardFilter', names: ['filterLength'] },
	],
	'audacity-graphic-eq': [
		{ titleKey: 'effectCardThirdOctaveBands', names: ['gains'], wide: true },
		{ titleKey: 'effectCardSettings', names: ['interpolation', 'filterLength'], wide: true },
	],
	'audacity-limiter': [
		{ titleKey: 'effectCardLevel', names: ['thresholdDb', 'makeupTargetDb'], knobs: true },
		{ titleKey: 'effectCardCharacter', names: ['lookaheadMs', 'kneeWidthDb', 'releaseMs'], knobs: true },
		{ titleKey: 'effectCardResponse', names: [], response: 'limiter', wide: true },
	],
	'audacity-loudness-normalization': [
		{ titleKey: 'effectCardTargetLoudness', names: ['mode', 'targetLufs', 'targetRmsDb'], wide: true },
		{ titleKey: 'effectCardChannels', names: ['stereoIndependent', 'dualMono'], wide: true },
	],
	'audacity-noise-reduction': [
		{ titleKey: 'effectCardStep2NoiseReduction', names: ['reductionDb', 'sensitivity', 'frequencySmoothingBands'], wide: true },
		{ titleKey: 'effectCardOutput', names: ['output'], wide: true },
	],
	'audacity-normalize': [
		{ titleKey: 'effectCardNormalize', names: ['removeDc', 'applyGain', 'peakDb', 'stereoIndependent'], wide: true },
	],
	'audacity-paulstretch': [
		{ titleKey: 'effectCardStretch', names: ['stretchFactor'] },
		{ titleKey: 'effectCardResolution', names: ['timeResolution'] },
	],
	'audacity-phaser': [
		{ titleKey: 'effectCardSweep', names: ['stages', 'frequency', 'phaseDegrees', 'depth'], knobs: true },
		{ titleKey: 'effectCardMix', names: ['dryWet', 'feedbackPercent', 'outputGainDb'], knobs: true },
	],
	'audacity-reverb': [
		{ titleKey: 'effectCardSpace', names: ['roomSize', 'stereoWidth'], knobs: true },
		{ titleKey: 'effectCardTone', names: ['damping', 'reverberance'], knobs: true },
		{ titleKey: 'effectCardMix', names: ['wetGainDb', 'dryGainDb', 'wetOnly'], knobs: true, wide: true },
	],
	'audacity-repeat': [
		{ titleKey: 'effectCardRepeat', names: ['count'], wide: true },
	],
	'audacity-classic-filters': [
		{ titleKey: 'effectCardFilter', names: ['family', 'direction', 'order', 'cutoffHz'], wide: true },
		{ titleKey: 'effectCardResponse', names: ['passbandRippleDb', 'stopbandAttenuationDb'], response: 'filter', wide: true },
	],
	'audacity-truncate-silence': [
		{ titleKey: 'effectCardDetectSilence', names: ['thresholdDb', 'minimumSilence'], wide: true },
		{ titleKey: 'effectCardAction', names: ['action', 'truncateTo', 'compressPercent'], wide: true },
	],
	'audacity-wahwah': [
		{ titleKey: 'effectCardSweep', names: ['frequency', 'phaseDegrees', 'depthPercent', 'frequencyOffsetPercent'], knobs: true },
		{ titleKey: 'effectCardCharacter', names: ['resonance', 'outputGainDb'], knobs: true },
	],
	highpass: [
		{ titleKey: 'effectCardHighPassFilter', names: ['frequency', 'q'], response: 'highpass', wide: true },
	],
	lowpass: [
		{ titleKey: 'effectCardLowPassFilter', names: ['frequency', 'q'], response: 'lowpass', wide: true },
	],
	eq: [
		{ titleKey: 'effectCardEqualizerBands', names: ['bands'], response: 'equalizer', wide: true },
	],
	compressor: [
		{ titleKey: 'effectCardCompression', names: ['threshold', 'knee', 'ratio', 'makeupGain'], knobs: true },
		{ titleKey: 'effectCardTiming', names: ['attack', 'release'], knobs: true },
		{ titleKey: 'effectCardResponse', names: [], response: 'compressor', wide: true },
	],
	limiter: [
		{ titleKey: 'effectCardLimiter', names: ['ceiling', 'lookahead', 'release'], knobs: true },
		{ titleKey: 'effectCardResponse', names: [], response: 'limiter', wide: true },
	],
	gate: [
		{ titleKey: 'effectCardDetection', names: ['threshold', 'rangeDb'], knobs: true },
		{ titleKey: 'effectCardEnvelope', names: ['attack', 'hold', 'release'], knobs: true },
		{ titleKey: 'effectCardResponse', names: [], response: 'gate', wide: true },
	],
	reverb: [
		{ titleKey: 'effectCardSpace', names: ['decay', 'preDelay'], knobs: true },
		{ titleKey: 'effectCardMix', names: ['mix'], knobs: true },
	],
	delay: [
		{ titleKey: 'effectCardDelay', names: ['time', 'feedback', 'mix'], knobs: true, wide: true },
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
	if (remaining.length) groups.push({ titleKey: 'effectCardSettings', names: remaining, wide: true });
	return groups;
}

function localizedCardTitle(titleKey, copy) {
	return canonicalCopyValue(titleKey, copy);
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
	copy,
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
						<section className={className} key={`${group.titleKey}-${groupIndex}`}>
							<h3 className="audio-editor-audacity-layout__heading">
								{localizedCardTitle(group.titleKey, copy)}
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
