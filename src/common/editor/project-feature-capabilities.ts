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
	musicalTimeline: 'org.soundscaper.capability.musical-timeline',
	timelineAnnotations: 'org.soundscaper.capability.timeline-annotations',
	trackFolders: 'org.soundscaper.capability.track-folders',
	audioWarp: 'org.soundscaper.capability.audio-warp',
	sequenceTiming: 'org.soundscaper.capability.sequence-timing',
	videoRetime: 'org.soundscaper.capability.video-retime',
	videoTimingAssets: 'org.soundscaper.capability.video-timing-assets',
	sourceCharacteristics: 'org.soundscaper.capability.source-characteristics',
} as const);

export type ProjectFeatureCapabilityKey = keyof typeof PROJECT_FEATURE_CAPABILITY_IDS;

const PROJECT_FEATURE_CAPABILITY_ID_SET = new Set<string>(Object.values(PROJECT_FEATURE_CAPABILITY_IDS));

export function isProjectFeatureCapabilityId(
	value: unknown,
): value is typeof PROJECT_FEATURE_CAPABILITY_IDS[ProjectFeatureCapabilityKey] {
	return typeof value === 'string' && PROJECT_FEATURE_CAPABILITY_ID_SET.has(value);
}

/** Registered first-party audio capabilities eligible for one whole-mix PCM fallback. */
export const PROJECT_FEATURE_AUDIO_CAPABILITY_IDS = Object.freeze([
	PROJECT_FEATURE_CAPABILITY_IDS.audioImport,
	PROJECT_FEATURE_CAPABILITY_IDS.audioPlayback,
	PROJECT_FEATURE_CAPABILITY_IDS.audioTimelineEditing,
	PROJECT_FEATURE_CAPABILITY_IDS.audioMixing,
	PROJECT_FEATURE_CAPABILITY_IDS.audioRecording,
	PROJECT_FEATURE_CAPABILITY_IDS.audioGenerators,
	PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
	PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
	PROJECT_FEATURE_CAPABILITY_IDS.audioAnalysis,
	PROJECT_FEATURE_CAPABILITY_IDS.audioMacros,
	PROJECT_FEATURE_CAPABILITY_IDS.audioSampleEditing,
	PROJECT_FEATURE_CAPABILITY_IDS.musicalTimeline,
	PROJECT_FEATURE_CAPABILITY_IDS.audioWarp,
] as const);

export type ProjectFeatureAudioCapabilityId = typeof PROJECT_FEATURE_AUDIO_CAPABILITY_IDS[number];

const PROJECT_FEATURE_AUDIO_CAPABILITY_ID_SET = new Set<string>(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS);

export function isProjectFeatureAudioCapabilityId(
	value: unknown,
): value is ProjectFeatureAudioCapabilityId {
	return typeof value === 'string' && PROJECT_FEATURE_AUDIO_CAPABILITY_ID_SET.has(value);
}

/** Registered first-party video capabilities eligible for one full-render fallback. */
export const PROJECT_FEATURE_VIDEO_CAPABILITY_IDS = Object.freeze([
	PROJECT_FEATURE_CAPABILITY_IDS.videoImport,
	PROJECT_FEATURE_CAPABILITY_IDS.videoPlayback,
	PROJECT_FEATURE_CAPABILITY_IDS.videoTimelineEditing,
	PROJECT_FEATURE_CAPABILITY_IDS.videoExport,
	PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
	PROJECT_FEATURE_CAPABILITY_IDS.sequenceTiming,
	PROJECT_FEATURE_CAPABILITY_IDS.videoRetime,
	PROJECT_FEATURE_CAPABILITY_IDS.videoTimingAssets,
] as const);

export type ProjectFeatureVideoCapabilityId = typeof PROJECT_FEATURE_VIDEO_CAPABILITY_IDS[number];

const PROJECT_FEATURE_VIDEO_CAPABILITY_ID_SET = new Set<string>(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS);

export function isProjectFeatureVideoCapabilityId(
	value: unknown,
): value is ProjectFeatureVideoCapabilityId {
	return typeof value === 'string' && PROJECT_FEATURE_VIDEO_CAPABILITY_ID_SET.has(value);
}

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
