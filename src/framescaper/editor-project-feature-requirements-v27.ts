/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirement,
	type ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';
import {
	FRAMESCAPER_V27_FEATURE_IDS,
	FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v27.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import { withoutFramescaperDialogueChainsV27 } from './editor-audio-dialogue-chain-v27.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';

export const FRAMESCAPER_V27_OWNED_REQUIREMENTS = Object.freeze({
	colorManagement: requirement('framescaper.video-color-management', FRAMESCAPER_V27_FEATURE_IDS.videoColorManagement, 'Managed video color'),
	grading: requirement('framescaper.video-grading', FRAMESCAPER_V27_FEATURE_IDS.videoGrading, 'Video grading'),
	motionTracking: requirement('framescaper.video-motion-tracking', FRAMESCAPER_V27_FEATURE_IDS.videoMotionTracking, 'Video motion tracking'),
	stabilization: requirement('framescaper.video-stabilization', FRAMESCAPER_V27_FEATURE_IDS.videoStabilization, 'Video stabilization'),
	denoise: requirement('framescaper.video-denoise', FRAMESCAPER_V27_FEATURE_IDS.videoDenoise, 'Video denoise'),
	captions: requirement('framescaper.video-captions', FRAMESCAPER_V27_FEATURE_IDS.videoCaptions, 'Video captions'),
	automation: requirement('framescaper.audio-automation', PROJECT_FEATURE_CAPABILITY_IDS.audioAutomation, 'Audio automation'),
	mixer: requirement('framescaper.audio-mixer-graph', PROJECT_FEATURE_CAPABILITY_IDS.audioMixerGraph, 'Audio mixer graph'),
});

export const FRAMESCAPER_V27_STATE_FIELDS = Object.freeze([
	'videoColorContexts', 'videoSourceColorInterpretations', 'videoVisualPresentations',
	'videoProcessorStacks', 'videoMotionAnalyses', 'videoFinishingPresets',
	'videoCaptionTracks', 'automationLanes', 'mixer',
]);

const OWNED_IDS = new Set(Object.values(FRAMESCAPER_V27_OWNED_REQUIREMENTS).map(({ id }) => id));
const OWNED_FEATURE_IDS = new Set(Object.values(FRAMESCAPER_V27_OWNED_REQUIREMENTS).map(({ featureId }) => featureId));

export function reconcileFramescaperProjectFeatureRequirementsV27(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV27Profile(profile);
	const candidate = record(project, 'Framescaper V27 project');
	const manifest = normalizeManifest(candidate);
	assertNoPublisherConflict(manifest);
	const foundation = structuredClone(candidate) as Record<string, unknown>;
	stripFramescaperProjectV27State(foundation);
	stripOwnedDialogueChains(foundation, data(candidate, 'sampleRate'));
	foundation.featureRequirements = withoutOwned(manifest);
	const baseline = reconcileFramescaperProjectFeatureRequirementsV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		foundation,
	);
	const owned: ProjectFeatureRequirement[] = [];
	if (array(candidate, 'videoColorContexts').length > 0
		|| array(candidate, 'videoSourceColorInterpretations').length > 0) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.colorManagement);
	}
	const presentations = records(array(candidate, 'videoVisualPresentations'), 'videoVisualPresentations');
	if (presentations.some(({ grade }) => grade !== null)) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.grading);
	}
	const processors = records(array(candidate, 'videoProcessorStacks'), 'videoProcessorStacks')
		.flatMap((stack) => records(stack.processors, 'videoProcessorStacks.processors'));
	if (processors.some(({ kind }) => kind === 'tracking')
		|| array(candidate, 'videoMotionAnalyses').length > 0) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.motionTracking);
	}
	if (processors.some(({ kind }) => kind === 'similarity-stabilization')) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.stabilization);
	}
	if (processors.some(({ kind }) => kind === 'spatial-denoise' || kind === 'temporal-denoise')) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.denoise);
	}
	if (array(candidate, 'videoCaptionTracks').length > 0) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.captions);
	}
	if (array(candidate, 'automationLanes').length > 0) {
		owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.automation);
	}
	owned.push(FRAMESCAPER_V27_OWNED_REQUIREMENTS.mixer);
	return Object.freeze({
		schemaVersion: baseline.schemaVersion,
		requirements: Object.freeze([...baseline.requirements, ...owned]),
	});
}

export function validateFramescaperProjectFeatureRequirementsV27(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV27Profile(profile);
	const candidate = record(project, 'Framescaper V27 project');
	const actual = normalizeManifest(candidate);
	assertNoPublisherConflict(actual);
	const expected = reconcileFramescaperProjectFeatureRequirementsV27(profile, candidate);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V27 feature requirements do not match owned finishing state.');
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceV27(profile: unknown) {
	assertFramescaperProjectV27Profile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown) {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (data(candidate, 'schemaVersion', true) !== 27) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV27(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: records(data(candidate, 'sources'), 'sources'),
			clips: records(data(candidate, 'clips'), 'clips'),
			tracks: records(data(candidate, 'tracks'), 'tracks'),
			schemaVersion: 27,
			sampleRate: data(candidate, 'sampleRate'),
			sequences: records(data(candidate, 'sequences'), 'sequences'),
			primarySequenceId: data(candidate, 'primarySequenceId'),
		});
	}
}

export function framescaperProjectFeatureRequirementsForV24FoundationV27(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV27Profile(profile);
	const candidate = record(project, 'Framescaper V27 project');
	const foundation = structuredClone(candidate) as Record<string, unknown>;
	stripFramescaperProjectV27State(foundation);
	foundation.featureRequirements = withoutOwned(normalizeManifest(candidate));
	return reconcileFramescaperProjectFeatureRequirementsV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		foundation,
	);
}

export function stripFramescaperProjectV27State(project: Record<string, unknown>): void {
	project.schemaVersion = 24;
	for (const field of FRAMESCAPER_V27_STATE_FIELDS) delete project[field];
	project.mixer = { groups: [], sends: [], routes: {} };
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type === 'audio') track.envelope = [];
	}
	const master = record(project.master, 'master');
	master.envelope = [];
}

function stripOwnedDialogueChains(project: Record<string, unknown>, sampleRate: unknown): void {
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type !== 'audio') continue;
		track.effects = withoutFramescaperDialogueChainsV27(
			data(track, 'effects'), sampleRate,
		);
	}
}

function withoutOwned(manifest: ProjectFeatureRequirementsManifest): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(({ id, featureId }) => (
			!OWNED_IDS.has(id) && !OWNED_FEATURE_IDS.has(featureId)
		))),
	});
}

function assertNoPublisherConflict(manifest: ProjectFeatureRequirementsManifest): void {
	for (const row of manifest.requirements) {
		const ownsId = OWNED_IDS.has(row.id);
		const ownsFeature = OWNED_FEATURE_IDS.has(row.featureId);
		if (ownsId !== ownsFeature || ((ownsId || ownsFeature)
			&& (row.disposition !== 'bypass' || row.fallback !== null))) {
			throw new TypeError('A publisher requirement cannot replace Framescaper V27 finishing ownership.');
		}
	}
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(data(project, 'featureRequirements'), {
		sources: records(data(project, 'sources'), 'sources'),
		clips: records(data(project, 'clips'), 'clips'),
		tracks: records(data(project, 'tracks'), 'tracks'),
		schemaVersion: data(project, 'schemaVersion'),
		sampleRate: data(project, 'sampleRate'),
		sequences: records(data(project, 'sequences'), 'sequences'),
		primarySequenceId: data(project, 'primarySequenceId'),
	});
}

function requirement(id: string, featureId: string, displayName: string): ProjectFeatureRequirement {
	return Object.freeze({ id, featureId, displayName, disposition: 'bypass', fallback: null });
}

function data(value: Record<string, unknown>, key: string, optional = false): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) {
		if (optional) return undefined;
		throw new TypeError(`${key} must be data.`);
	}
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be data.`);
	return descriptor.value;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
	const candidate = data(value, key);
	if (!Array.isArray(candidate)) throw new TypeError(`${key} must be an array.`);
	return candidate;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
