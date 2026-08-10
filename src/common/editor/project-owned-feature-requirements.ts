/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_FEATURE_AUDIO_EFFECT_TYPES,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirement,
	ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { PROJECT_FEATURE_REQUIREMENTS_LIMITS } from './project-feature-requirements.ts';
import { projectHasReportedSourceCharacteristics } from './source-characteristics-v14.ts';
import { VIDEO_EFFECT_TYPES } from './video-effects.js';

export const PROJECT_OWNED_FEATURE_REQUIREMENT_IDS = Object.freeze({
	audioEffects: 'soundscaper.audio-effects',
	videoEffects: 'soundscaper.video-effects',
	musicalTimeline: 'soundscaper.musical-timeline',
	timelineAnnotations: 'soundscaper.timeline-annotations',
	trackFolders: 'soundscaper.track-folders',
	audioWarp: 'soundscaper.audio-warp',
	sequenceTiming: 'framescaper.sequence-timing',
	videoRetime: 'framescaper.video-retime',
	videoTimingAssets: 'framescaper.video-timing-assets',
	sourceCharacteristics: 'framescaper.source-characteristics',
} as const);

type RecordValue = Readonly<Record<string, unknown>>;

interface OwnedFeatureRequirement {
	readonly requirement: ProjectFeatureRequirement;
	readonly conflictMessage: string;
	readonly projectNeedsRequirement: (project: Readonly<Record<string, unknown>>) => boolean;
}

const AUDIO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_FEATURE_AUDIO_EFFECT_TYPES);
const VIDEO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(VIDEO_EFFECT_TYPES as readonly string[]);
const OWNED_AUDIO_EFFECT_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
	displayName: 'Audio effects',
	disposition: 'bypass',
	fallback: null,
});
const OWNED_VIDEO_EFFECT_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	displayName: 'Video effects',
	disposition: 'bypass',
	fallback: null,
});
const FOUNDATION_REQUIREMENTS = Object.freeze({
	musicalTimeline: requirement('musicalTimeline', 'Musical timeline'),
	timelineAnnotations: requirement('timelineAnnotations', 'Timeline markers and regions'),
	trackFolders: requirement('trackFolders', 'Nested track folders'),
	audioWarp: requirement('audioWarp', 'Audio warp maps'),
	sequenceTiming: requirement('sequenceTiming', 'Sequence timing'),
	videoRetime: requirement('videoRetime', 'Video retime maps'),
	videoTimingAssets: requirement('videoTimingAssets', 'Exact video timing assets'),
	sourceCharacteristics: requirement('sourceCharacteristics', 'Probed source characteristics'),
});
const OWNED_FEATURE_REQUIREMENTS: readonly OwnedFeatureRequirement[] = Object.freeze([
	Object.freeze({
		requirement: OWNED_AUDIO_EFFECT_REQUIREMENT,
		conflictMessage: 'The reserved owned audio-effects requirement conflicts with publisher data.',
		projectNeedsRequirement: projectHasMaintainedAudioEffects,
	}),
	Object.freeze({
		requirement: OWNED_VIDEO_EFFECT_REQUIREMENT,
		conflictMessage: 'The reserved owned video-effects requirement conflicts with publisher data.',
		projectNeedsRequirement: projectHasMaintainedVideoEffects,
	}),
	foundationOwned(FOUNDATION_REQUIREMENTS.musicalTimeline, projectHasMusicalTimeline),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.timelineAnnotations,
		(project) => dataArray(project, 'timelineAnnotations').length > 0,
	),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.trackFolders,
		(project) => dataArray(project, 'trackFolders').length > 0,
	),
	foundationOwned(FOUNDATION_REQUIREMENTS.audioWarp, (project) => projectHasClipField(project, 'audio', 'warpMap')),
	foundationOwned(FOUNDATION_REQUIREMENTS.sequenceTiming, projectHasNonDefaultSequenceTiming),
	foundationOwned(FOUNDATION_REQUIREMENTS.videoRetime, (project) => projectHasClipField(project, 'video', 'retimeMap')),
	foundationOwned(FOUNDATION_REQUIREMENTS.videoTimingAssets, projectHasVideoTimingAsset),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.sourceCharacteristics,
		projectHasReportedSourceCharacteristics,
	),
]);

function requirement(
	key: 'musicalTimeline' | 'timelineAnnotations' | 'trackFolders' | 'audioWarp' | 'sequenceTiming'
		| 'videoRetime' | 'videoTimingAssets' | 'sourceCharacteristics',
	displayName: string,
): ProjectFeatureRequirement {
	return Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS[key],
		featureId: PROJECT_FEATURE_CAPABILITY_IDS[key],
		displayName,
		disposition: 'bypass',
		fallback: null,
	});
}

function foundationOwned(
	requirementValue: ProjectFeatureRequirement,
	predicate: OwnedFeatureRequirement['projectNeedsRequirement'],
): OwnedFeatureRequirement {
	return Object.freeze({
		requirement: requirementValue,
		conflictMessage: `The reserved owned ${requirementValue.id} requirement conflicts with publisher data.`,
		projectNeedsRequirement: predicate,
	});
}

/**
 * Keep editor-owned declarations aligned with maintained effect state. A
 * publisher-owned declaration for the same feature always wins.
 */
export function reconcileProjectOwnedFeatureRequirements(
	project: Readonly<Record<string, unknown>>,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	let reconciled = manifest;
	for (const owned of OWNED_FEATURE_REQUIREMENTS) {
		reconciled = reconcileOwnedFeatureRequirement(project, reconciled, owned);
	}
	return reconciled;
}

function reconcileOwnedFeatureRequirement(
	project: Readonly<Record<string, unknown>>,
	manifest: ProjectFeatureRequirementsManifest,
	owned: OwnedFeatureRequirement,
): ProjectFeatureRequirementsManifest {
	const requirement = owned.requirement;
	const ownedIndex = manifest.requirements.findIndex(
		(candidate) => candidate.id === requirement.id,
	);
	if (ownedIndex >= 0 && !ownedRequirementMatches(manifest.requirements[ownedIndex], requirement)) {
		throw new TypeError(owned.conflictMessage);
	}
	const explicitRequirement = manifest.requirements.some((candidate) => (
		candidate.id !== requirement.id
		&& candidate.featureId === requirement.featureId
	));
	const needsOwnedRequirement = !explicitRequirement && owned.projectNeedsRequirement(project);
	if (needsOwnedRequirement && ownedIndex >= 0) return manifest;
	if (!needsOwnedRequirement && ownedIndex < 0) return manifest;

	const requirements = manifest.requirements.filter(
		(candidate) => candidate.id !== requirement.id,
	);
	if (needsOwnedRequirement) {
		if (requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
			throw new RangeError('Owned project feature requirements exceed the manifest limit.');
		}
		requirements.push(requirement);
	}
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

function ownedRequirementMatches(
	actual: ProjectFeatureRequirement | undefined,
	expected: ProjectFeatureRequirement,
): boolean {
	return Boolean(
		actual
		&& actual.featureId === expected.featureId
		&& actual.displayName === expected.displayName
		&& actual.disposition === expected.disposition
		&& actual.fallback === null,
	);
}

function projectHasMaintainedAudioEffects(project: Readonly<Record<string, unknown>>): boolean {
	const tracks = dataArray(project, 'tracks');
	for (const track of tracks) {
		if (!isRecord(track)) continue;
		const type = dataProperty(track, 'type');
		if (type === 'label' || type === 'video') continue;
		if (rackHasMaintainedAudioEffect(track)) return true;
	}
	const mixer = dataProperty(project, 'mixer');
	if (isRecord(mixer)) {
		for (const key of ['groups', 'sends']) {
			for (const owner of dataArray(mixer, key)) {
				if (isRecord(owner) && rackHasMaintainedAudioEffect(owner)) return true;
			}
		}
	}
	const master = dataProperty(project, 'master');
	return isRecord(master) && rackHasMaintainedAudioEffect(master);
}

function rackHasMaintainedAudioEffect(owner: RecordValue): boolean {
	for (const effect of dataArray(owner, 'effects')) {
		if (!isRecord(effect)) continue;
		const type = dataProperty(effect, 'type');
		if (typeof type === 'string' && AUDIO_EFFECT_TYPE_SET.has(type)) return true;
	}
	return false;
}

function projectHasMaintainedVideoEffects(project: Readonly<Record<string, unknown>>): boolean {
	if (clipCollectionHasMaintainedVideoEffects(dataArray(project, 'clips'))) return true;
	const projectBin = dataProperty(project, 'projectBin');
	return isRecord(projectBin)
		&& clipCollectionHasMaintainedVideoEffects(dataArray(projectBin, 'clips'));
}

function projectHasMusicalTimeline(project: Readonly<Record<string, unknown>>): boolean {
	const tempoMap = dataProperty(project, 'tempoMap');
	if (isRecord(tempoMap)) {
		const events = dataArray(tempoMap, 'events');
		if (dataProperty(tempoMap, 'mode') !== 'musical' || events.length !== 1 || !isDefaultTempo(events[0])) return true;
	}
	const signatureMap = dataProperty(project, 'signatureMap');
	if (isRecord(signatureMap)) {
		const events = dataArray(signatureMap, 'events');
		if (events.length !== 1 || !isDefaultSignature(events[0])) return true;
	}
	for (const clip of projectClips(project)) {
		if (isRecord(clip) && dataProperty(clip, 'kind') === 'audio' && dataProperty(clip, 'anchor') === 'musical') return true;
	}
	for (const track of dataArray(project, 'tracks')) {
		if (!isRecord(track) || dataProperty(track, 'type') !== 'label') continue;
		if (dataArray(track, 'labels').some((label) => isRecord(label) && dataProperty(label, 'anchor') === 'musical')) return true;
	}
	return false;
}

function projectHasClipField(
	project: Readonly<Record<string, unknown>>,
	kind: 'audio' | 'video',
	field: 'warpMap' | 'retimeMap',
): boolean {
	return projectClips(project).some((clip) => isRecord(clip)
		&& dataProperty(clip, 'kind') === kind
		&& dataProperty(clip, field) != null);
}

function projectHasNonDefaultSequenceTiming(project: Readonly<Record<string, unknown>>): boolean {
	return dataArray(project, 'sequences').some((value) => {
		if (!isRecord(value)) return false;
		const rate = dataProperty(value, 'rate');
		const timecode = dataProperty(value, 'startTimecode');
		return dataProperty(value, 'dropFrame') === true
			|| !isRational(rate, 30, 1)
			|| (isRecord(timecode) && ['negative', 'hours', 'minutes', 'seconds', 'frames']
				.some((key) => Boolean(dataProperty(timecode, key))));
	});
}

function projectHasVideoTimingAsset(project: Readonly<Record<string, unknown>>): boolean {
	return dataArray(project, 'sources').some((source) => isRecord(source)
		&& dataProperty(source, 'kind') === 'video'
		&& dataProperty(source, 'timingAsset') != null);
}

function projectClips(project: Readonly<Record<string, unknown>>): readonly unknown[] {
	const bin = dataProperty(project, 'projectBin');
	return [...dataArray(project, 'clips'), ...(isRecord(bin) ? dataArray(bin, 'clips') : [])];
}

function isDefaultTempo(value: unknown): boolean {
	return isRecord(value) && isRational(dataProperty(value, 'beat'), 0, 1)
		&& isRational(dataProperty(value, 'bpm'), 120, 1);
}

function isDefaultSignature(value: unknown): boolean {
	return isRecord(value) && dataProperty(value, 'bar') === 0
		&& dataProperty(value, 'numerator') === 4 && dataProperty(value, 'denominator') === 4;
}

function isRational(value: unknown, num: number, den: number): boolean {
	return isRecord(value) && dataProperty(value, 'num') === num && dataProperty(value, 'den') === den;
}

function clipCollectionHasMaintainedVideoEffects(clips: readonly unknown[]): boolean {
	for (const clip of clips) {
		if (!isRecord(clip) || dataProperty(clip, 'kind') !== 'video') continue;
		for (const effect of dataArray(clip, 'videoEffects')) {
			if (!isRecord(effect)) continue;
			const type = dataProperty(effect, 'type');
			if (typeof type === 'string' && VIDEO_EFFECT_TYPE_SET.has(type)) return true;
		}
	}
	return false;
}

function dataArray(value: RecordValue, key: string): readonly unknown[] {
	const candidate = dataProperty(value, key);
	return Array.isArray(candidate) ? candidate : [];
}

function dataProperty(value: RecordValue, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`Project ${key} must be a data property.`);
	return descriptor.value;
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
