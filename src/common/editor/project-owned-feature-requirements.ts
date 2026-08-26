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
import {
	isSoundscaperProductionProjectSchema,
	isVideoRetimeCurveProjectSchema,
} from './project-schema-version.ts';
import { createDefaultMixerGraphV21, normalizeMixerGraphV21 } from './mixer-graph-v21.ts';
import { resolveTerminalChannelWidths } from './terminal-channel-widths.ts';
import { VIDEO_EFFECT_TYPES } from './video-effects.js';

export const PROJECT_OWNED_FEATURE_REQUIREMENT_IDS = Object.freeze({
	assistanceAssets: 'soundscaper.assistance-assets',
	audioEffects: 'soundscaper.audio-effects',
	videoEffects: 'soundscaper.video-effects',
	musicalTimeline: 'soundscaper.musical-timeline',
	timelineAnnotations: 'soundscaper.timeline-annotations',
	trackFolders: 'soundscaper.track-folders',
	takeComp: 'soundscaper.take-comp',
	audioWarp: 'soundscaper.audio-warp',
	audioAutomation: 'soundscaper.audio-automation',
	audioMixerGraph: 'soundscaper.audio-mixer-graph',
	masteringSequences: 'soundscaper.mastering-sequences',
	immersiveAdm: 'soundscaper.immersive-adm',
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
	readonly refusesPublisherSubstitution?: (project: Readonly<Record<string, unknown>>) => boolean;
}

const AUDIO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_FEATURE_AUDIO_EFFECT_TYPES);
const SHIPPED_ADM_BED_LAYOUTS: ReadonlySet<string> = new Set(['mono', 'stereo', '5.1']);
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
	assistanceAssets: requirement('assistanceAssets', 'Assistance assets'),
	musicalTimeline: requirement('musicalTimeline', 'Musical timeline'),
	timelineAnnotations: requirement('timelineAnnotations', 'Timeline markers and regions'),
	trackFolders: requirement('trackFolders', 'Nested track folders'),
	takeComp: requirement('takeComp', 'Take lanes and comps'),
	audioWarp: requirement('audioWarp', 'Audio warp maps'),
	audioAutomation: requirement('audioAutomation', 'Audio automation'),
	audioMixerGraph: requirement('audioMixerGraph', 'Audio mixer graph'),
	masteringSequences: requirement('masteringSequences', 'Mastering sequences'),
	immersiveAdm: requirement('immersiveAdm', 'Immersive ADM delivery'),
	sequenceTiming: requirement('sequenceTiming', 'Sequence timing'),
	videoRetime: requirement('videoRetime', 'Video retime maps'),
	videoTimingAssets: requirement('videoTimingAssets', 'Exact video timing assets'),
	sourceCharacteristics: requirement('sourceCharacteristics', 'Probed source characteristics'),
});
const OWNED_ASSISTANCE_FEATURE_REQUIREMENT = foundationOwned(
	FOUNDATION_REQUIREMENTS.assistanceAssets,
	(project) => dataArray(project, 'assistanceAssets').length > 0,
	() => true,
);
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
	OWNED_ASSISTANCE_FEATURE_REQUIREMENT,
	foundationOwned(FOUNDATION_REQUIREMENTS.musicalTimeline, projectHasMusicalTimeline),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.timelineAnnotations,
		(project) => dataArray(project, 'timelineAnnotations').length > 0,
	),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.trackFolders,
		(project) => dataArray(project, 'trackFolders').length > 0,
	),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.takeComp,
		(project) => dataArray(project, 'takeGroups').length > 0,
		() => true,
	),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.audioWarp,
		(project) => projectHasClipField(project, 'audio', 'warpMap'),
		(project) => projectHasClipField(project, 'audio', 'warpMap'),
	),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.audioAutomation,
		(project) => dataArray(project, 'automationLanes').length > 0,
		() => true,
	),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.audioMixerGraph,
		projectHasAuthoredMixerGraphV21,
		() => true,
	),
	foundationOwned(FOUNDATION_REQUIREMENTS.sequenceTiming, projectHasNonDefaultSequenceTiming),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.videoRetime,
		(project) => projectHasClipField(project, 'video', 'retimeMap'),
		(project) => isVideoRetimeCurveProjectSchema(dataProperty(project, 'schemaVersion')),
	),
	foundationOwned(FOUNDATION_REQUIREMENTS.masteringSequences, projectHoldsMasteringSequence),
	foundationOwned(FOUNDATION_REQUIREMENTS.immersiveAdm, projectHoldsImmersiveAdm, () => true),
	foundationOwned(FOUNDATION_REQUIREMENTS.videoTimingAssets, projectHasVideoTimingAsset),
	foundationOwned(
		FOUNDATION_REQUIREMENTS.sourceCharacteristics,
		projectHasReportedSourceCharacteristics,
	),
]);

function requirement(
	key: 'assistanceAssets' | 'musicalTimeline' | 'timelineAnnotations' | 'trackFolders' | 'takeComp' | 'audioWarp'
		| 'audioAutomation' | 'audioMixerGraph' | 'masteringSequences' | 'immersiveAdm' | 'sequenceTiming'
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
	refusesPublisherSubstitution?: OwnedFeatureRequirement['refusesPublisherSubstitution'],
): OwnedFeatureRequirement {
	return Object.freeze({
		requirement: requirementValue,
		conflictMessage: `The reserved owned ${requirementValue.id} requirement conflicts with publisher data.`,
		projectNeedsRequirement: predicate,
		...(refusesPublisherSubstitution ? { refusesPublisherSubstitution } : {}),
	});
}

/**
 * Keep editor-owned declarations aligned with maintained state. Publisher
 * declarations normally win; exact take/comp, audio-warp, and V16 retime state
 * refuse substitution because none can degrade to an unrelated media render.
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

/** Reconcile only assistance custody when a product owns the remaining feature declarations. */
export function reconcileProjectOwnedAssistanceRequirement(
	project: Readonly<Record<string, unknown>>,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return reconcileOwnedFeatureRequirement(project, manifest, OWNED_ASSISTANCE_FEATURE_REQUIREMENT);
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
	const projectNeedsRequirement = owned.projectNeedsRequirement(project);
	const refusesPublisherSubstitution = projectNeedsRequirement
		&& (owned.refusesPublisherSubstitution?.(project) ?? false);
	if (explicitRequirement && refusesPublisherSubstitution) throw new TypeError(owned.conflictMessage);
	const needsOwnedRequirement = projectNeedsRequirement
		&& (!explicitRequirement || refusesPublisherSubstitution);
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

/**
 * A project holding a mastering sequence demands the capability, so opening it
 * where the capability is unavailable reports the loss rather than dropping the
 * sequence quietly. Holding one is the trigger — an empty collection is the same
 * project as one that never had the field.
 */
function projectHoldsMasteringSequence(project: Readonly<Record<string, unknown>>): boolean {
	const sequences = dataProperty(project, 'masteringSequences');
	return Array.isArray(sequences) && sequences.length > 0;
}

/**
 * A project whose authored ADM goes beyond what shipped before immersive
 * delivery: positioned objects, or a bed layout above 5.1.
 *
 * The three original layouts are deliberately not a trigger. A stereo bed is the
 * feature that has always been there, and demanding a new capability for it
 * would report a loss on every project that ever enabled ADM.
 *
 * Publisher substitution is refused because there is nothing to substitute: an
 * environment without the capability cannot deliver these channels at all, and
 * silently rendering the bed without its objects is a different programme.
 */
function projectHoldsImmersiveAdm(project: Readonly<Record<string, unknown>>): boolean {
	const metadata = dataProperty(project, 'metadata');
	if (!isRecord(metadata)) return false;
	const adm = dataProperty(metadata, 'adm');
	if (!isRecord(adm) || dataProperty(adm, 'mode') !== 'authored') return false;
	if (dataArray(adm, 'objects').length > 0) return true;
	const bed = dataProperty(adm, 'bed');
	const layout = isRecord(bed) ? dataProperty(bed, 'layout') : null;
	return typeof layout === 'string' && !SHIPPED_ADM_BED_LAYOUTS.has(layout);
}

function projectHasVideoTimingAsset(project: Readonly<Record<string, unknown>>): boolean {
	return dataArray(project, 'sources').some((source) => isRecord(source)
		&& dataProperty(source, 'kind') === 'video'
		&& dataProperty(source, 'timingAsset') != null);
}

function projectHasAuthoredMixerGraphV21(project: Readonly<Record<string, unknown>>): boolean {
	if (!isSoundscaperProductionProjectSchema(dataProperty(project, 'schemaVersion'))) return false;
	const masterChannels = Number(dataProperty(project, 'masterChannels'));
	const trackWidths = resolveTerminalChannelWidths(project as never, masterChannels).tracks;
	const audioTracks = dataArray(project, 'tracks')
		.filter((track) => isRecord(track) && dataProperty(track, 'type') === 'audio')
		.map((track) => {
			const id = String(dataProperty(track as RecordValue, 'id'));
			return { id, channelCount: trackWidths.get(id) ?? masterChannels };
		});
	const graph = normalizeMixerGraphV21(dataProperty(project, 'mixer'));
	const expected = createDefaultMixerGraphV21(audioTracks, masterChannels);
	return JSON.stringify(graph) !== JSON.stringify(expected);
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
