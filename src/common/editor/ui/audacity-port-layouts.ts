/* SPDX-License-Identifier: AGPL-3.0-only */

/** Parameter placement follows Audacity's pinned Qt views; older ports follow
 * their wx effect editor until Audacity provides a Qt view for them. */
export interface AudacityPortSection {
	readonly id: string;
	readonly names: readonly string[];
	readonly columns?: number;
	readonly boxed?: boolean;
	readonly largeKnobs?: boolean;
	readonly titleKey?: string;
	readonly divider?: boolean;
}

const PORT_SECTIONS: Readonly<Record<string, readonly AudacityPortSection[]>> = {
	'highpass-filter': [{ id: 'settings', names: ['frequency', 'rolloff'] }],
	'lowpass-filter': [{ id: 'settings', names: ['frequency', 'rolloff'] }],
	'notch-filter': [{ id: 'settings', names: ['frequency', 'q'] }],
	'shelf-filter': [{ id: 'settings', names: ['filterType', 'frequency', 'gain'] }],
	'noise-gate': [{ id: 'settings', names: ['stereoLink', 'threshold', 'gateFrequency', 'rangeDb', 'attack', 'hold', 'release'] },
		{ id: 'advanced', names: ['lookahead'] }],
	'multi-tap-delay': [{ id: 'settings', names: ['delayType', 'echoGain', 'time', 'pitchMode', 'pitchShift', 'echoes', 'duration'] },
		{ id: 'advanced', names: ['mix'] }],
	'tremolo': [{ id: 'settings', names: ['waveform', 'phase', 'depth', 'frequency'] }],
	'vocoder': [{ id: 'settings', names: ['distance', 'outputMode', 'bands', 'carrierLevel', 'noiseLevel', 'radarLevel', 'radarFrequency'] },
		{ id: 'advanced', names: ['outputGain'] }],
	'audacity-amplify': [{ id: 'settings', names: ['gainDb', 'allowClipping'] }],
	'audacity-auto-duck': [
		{ id: 'fades', names: ['duckAmountDb', 'maximumPause', 'outerFadeDown', 'outerFadeUp', 'innerFadeDown', 'innerFadeUp'], columns: 2 },
		{ id: 'threshold', names: ['thresholdDb'] },
	],
	'audacity-bass-treble': [
		{ id: 'tone', names: ['bassDb', 'trebleDb'], columns: 2, boxed: true, largeKnobs: true },
		{ id: 'output', names: ['volumeDb'], boxed: true, largeKnobs: true },
	],
	'audacity-click-removal': [{ id: 'settings', names: ['threshold', 'maximumWidth'] }],
	'audacity-change-pitch': [{ id: 'pitch', names: ['semitones'], boxed: true }, { id: 'quality', names: ['preserveFormants'] }],
	'audacity-change-tempo': [{ id: 'settings', names: ['tempoPercent'] }],
	'audacity-change-speed-pitch': [{ id: 'settings', names: ['speedPercent'] }],
	'audacity-sliding-stretch': [
		{ id: 'initial-tempo', titleKey: 'effectCardInitialTempoChange', names: ['startTempoPercent'], boxed: true },
		{ id: 'final-tempo', titleKey: 'effectCardFinalTempoChange', names: ['endTempoPercent'], boxed: true },
		{ id: 'initial-pitch', titleKey: 'effectCardInitialPitchShift', names: ['startPitchSemitones'], boxed: true },
		{ id: 'final-pitch', titleKey: 'effectCardFinalPitchShift', names: ['endPitchSemitones'], boxed: true },
		{ id: 'quality', names: ['preserveFormants'] },
	],
	'audacity-legacy-compressor': [
		{ id: 'compression', names: ['thresholdDb', 'noiseFloorDb', 'ratio', 'attackSeconds', 'releaseSeconds'] },
		{ id: 'options', names: ['normalize', 'usePeak'] },
	],
	'audacity-distortion': [
		{ id: 'mode', names: ['mode', 'dcBlock'], columns: 2 },
		{ id: 'thresholds', titleKey: 'effectCardThresholdControls', names: ['thresholdDb', 'noiseFloorDb'], boxed: true },
		{ id: 'parameters', titleKey: 'effectCardParameterControls', names: ['parameter1', 'parameter2', 'repeats'], boxed: true },
	],
	'audacity-echo': [{ id: 'settings', names: ['delaySeconds', 'decay'] }],
	'audacity-filter-curve-eq': [{ id: 'curve', names: ['points'] }, { id: 'settings', names: ['linearFrequencyScale', 'filterLength'], columns: 2 }],
	'audacity-graphic-eq': [{ id: 'bands', names: ['gains'] }, { id: 'settings', names: ['interpolation', 'filterLength'], columns: 2 }],
	'audacity-loudness-normalization': [
		{ id: 'target', names: ['mode', 'targetLufs', 'targetRmsDb'], columns: 2 },
		{ id: 'options', names: ['stereoIndependent', 'dualMono'] },
	],
	'audacity-noise-reduction': [
		{ id: 'reduction', titleKey: 'effectCardStep2NoiseReduction', names: ['reductionDb', 'sensitivity', 'frequencySmoothingBands', 'output'], boxed: true },
	],
	'audacity-normalize': [
		{ id: 'dc', names: ['removeDc'] },
		{ id: 'target', names: ['applyGain', 'peakDb'], columns: 2 },
		{ id: 'stereo', names: ['stereoIndependent'] },
	],
	'audacity-paulstretch': [{ id: 'settings', names: ['stretchFactor', 'timeResolution'], columns: 2 }],
	'audacity-phaser': [{ id: 'settings', names: ['stages', 'dryWet', 'frequency', 'phaseDegrees', 'depth', 'feedbackPercent', 'outputGainDb'] }],
	'audacity-reverb': [
		{ id: 'space', names: ['roomSize', 'stereoWidth', 'preDelay'], columns: 2, boxed: true, largeKnobs: true },
		{ id: 'tone', names: ['damping', 'reverberance', 'toneLow', 'toneHigh'], columns: 2 },
		{ id: 'mix', names: ['wetGainDb', 'dryGainDb', 'wetOnly'], columns: 2, divider: true },
	],
	'audacity-repeat': [{ id: 'settings', names: ['count'] }],
	'audacity-classic-filters': [{ id: 'settings', names: ['family', 'direction', 'order', 'cutoffHz', 'passbandRippleDb', 'stopbandAttenuationDb'], columns: 2 }],
	'audacity-truncate-silence': [
		{ id: 'detection', titleKey: 'effectCardDetectSilence', names: ['thresholdDb', 'minimumSilence'], columns: 2, boxed: true },
		{ id: 'action', titleKey: 'effectCardAction', names: ['action', 'truncateTo', 'compressPercent'], boxed: true },
	],
	'audacity-wahwah': [{ id: 'settings', names: ['frequency', 'phaseDegrees', 'depthPercent', 'resonance', 'frequencyOffsetPercent', 'outputGainDb'] }],
};

const NYQUIST_PORTS = new Set(['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter',
	'noise-gate', 'multi-tap-delay', 'tremolo', 'vocoder']);

export function isAudacityNyquistPort(effectType: string): boolean {
	return NYQUIST_PORTS.has(effectType);
}

/** Pinned .ny FLOAT-TEXT controls omit the slider; other numerics use a flat
 * textbox and linear slider. Display units retain the backend's existing values. */
export function audacityNyquistControl(effectType: string, name: string): Readonly<{
	presentation: 'number' | 'slider'; scale: number; unit?: string;
}> | null {
	if (!isAudacityNyquistPort(effectType)) return null;
	const textbox = (['highpass-filter', 'lowpass-filter', 'notch-filter'].includes(effectType)
		&& ['frequency', 'q'].includes(name)) || (effectType === 'tremolo' && name === 'frequency');
	const sourceSeconds = effectType === 'noise-gate' && ['attack', 'hold', 'release'].includes(name);
	const sourceKilohertz = effectType === 'noise-gate' && name === 'gateFrequency';
	return { presentation: textbox || ['lookahead', 'mix', 'outputGain'].includes(name) ? 'number' : 'slider',
		scale: sourceSeconds ? 1000 : sourceKilohertz ? 0.001 : 1,
		...(sourceSeconds ? { unit: 'ms' } : sourceKilohertz ? { unit: 'kHz' } : {}),
	};
}

export function audacityPortSections(effectType: string, parameterNames: readonly string[]): readonly AudacityPortSection[] {
	const available = new Set(parameterNames);
	const assigned = new Set<string>();
	const sections: AudacityPortSection[] = [];
	for (const section of PORT_SECTIONS[effectType] || []) {
		const names = section.names.filter(name => available.has(name) && !assigned.has(name));
		for (const name of names) assigned.add(name);
		if (names.length) sections.push({ ...section, names });
	}
	const remaining = parameterNames.filter(name => !assigned.has(name));
	if (remaining.length) sections.push({ id: 'other', names: remaining });
	return sections;
}

/** Qt view content widths plus the effect viewer's 16px padding on each side. */
export function audacityEffectDialogWidth(effectType: string): number | null {
	const widths: Readonly<Record<string, number>> = {
		'highpass-filter': 500,
		'lowpass-filter': 500,
		'notch-filter': 500,
		'shelf-filter': 660,
		'noise-gate': 660,
		'multi-tap-delay': 660,
		'tremolo': 660,
		'vocoder': 660,
		'audacity-amplify': 352,
		'audacity-bass-treble': 452,
		'audacity-click-removal': 360,
		'audacity-change-pitch': 480,
		'audacity-sliding-stretch': 560,
		'audacity-filter-curve-eq': 840,
		'audacity-graphic-eq': 840,
		'audacity-loudness-normalization': 480,
		'audacity-noise-reduction': 560,
		'audacity-normalize': 432,
		'audacity-paulstretch': 452,
		'audacity-reverb': 568,
		'audacity-truncate-silence': 360,
	};
	return widths[effectType] ?? null;
}
