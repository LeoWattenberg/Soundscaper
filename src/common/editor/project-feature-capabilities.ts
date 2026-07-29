/* SPDX-License-Identifier: AGPL-3.0-only */

export const PROJECT_FEATURE_CAPABILITY_IDS = Object.freeze({
	project: 'org.soundscaper.capability.project',
	projectBin: 'org.soundscaper.capability.project-bin',
	audioImport: 'org.soundscaper.capability.audio-import',
	audioPlayback: 'org.soundscaper.capability.audio-playback',
	audioTimelineEditing: 'org.soundscaper.capability.audio-timeline-editing',
	audioMixing: 'org.soundscaper.capability.audio-mixing',
	videoImport: 'org.soundscaper.capability.video-import',
	videoPlayback: 'org.soundscaper.capability.video-playback',
	videoTimelineEditing: 'org.soundscaper.capability.video-timeline-editing',
	videoExport: 'org.soundscaper.capability.video-export',
	audioRecording: 'org.soundscaper.capability.audio-recording',
	audioGenerators: 'org.soundscaper.capability.audio-generators',
	audioEffects: 'org.soundscaper.capability.audio-effects',
	audioSpectralEditing: 'org.soundscaper.capability.audio-spectral-editing',
	audioAnalysis: 'org.soundscaper.capability.audio-analysis',
	audioMacros: 'org.soundscaper.capability.audio-macros',
	audioSampleEditing: 'org.soundscaper.capability.audio-sample-editing',
	videoEffects: 'org.soundscaper.capability.video-effects',
	videoCompositing: 'org.soundscaper.capability.video-compositing',
} as const);

export type ProjectFeatureCapabilityKey = keyof typeof PROJECT_FEATURE_CAPABILITY_IDS;

/** Maintained rack processors owned by the first-party audio-effects capability. */
export const PROJECT_FEATURE_AUDIO_EFFECT_TYPES = Object.freeze([
	'highpass',
	'lowpass',
	'eq',
	'compressor',
	'limiter',
	'gate',
	'reverb',
	'delay',
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
] as const);

export interface ProjectFeatureCapabilitySnapshot {
	readonly knownFeatureIds: readonly string[];
	readonly availableFeatureIds: readonly string[];
}

export function snapshotProjectFeatureCapabilities(
	value: Readonly<Record<string, unknown>>,
): ProjectFeatureCapabilitySnapshot {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Project feature capabilities must be an object.');
	}
	const entries = Object.entries(PROJECT_FEATURE_CAPABILITY_IDS) as ReadonlyArray<
		readonly [ProjectFeatureCapabilityKey, string]
	>;
	return Object.freeze({
		knownFeatureIds: Object.freeze(entries.map(([, featureId]) => featureId)),
		availableFeatureIds: Object.freeze(entries
			.filter(([capability]) => value[capability] === true)
			.map(([, featureId]) => featureId)),
	});
}
