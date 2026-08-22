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
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV22,
} from './editor-project-feature-requirements-v22.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v24.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';

export const FRAMESCAPER_V24_VISUAL_REQUIREMENTS = Object.freeze({
	stills: requirement('framescaper.video-stills', PROJECT_FEATURE_CAPABILITY_IDS.videoStills, 'Video stills'),
	generators: requirement('framescaper.video-generators', PROJECT_FEATURE_CAPABILITY_IDS.videoGenerators, 'Video generators'),
	adjustmentLayers: requirement('framescaper.video-adjustment-layers', PROJECT_FEATURE_CAPABILITY_IDS.videoAdjustmentLayers, 'Video adjustment layers'),
	masksMattes: requirement('framescaper.video-masks-mattes', PROJECT_FEATURE_CAPABILITY_IDS.videoMasksMattes, 'Video masks and mattes'),
	freeze: requirement('framescaper.video-freeze', PROJECT_FEATURE_CAPABILITY_IDS.videoFreeze, 'Video freeze'),
});

const OWNED_IDS = new Set(Object.values(FRAMESCAPER_V24_VISUAL_REQUIREMENTS).map(({ id }) => id));
const OWNED_FEATURE_IDS = new Set(Object.values(FRAMESCAPER_V24_VISUAL_REQUIREMENTS).map(({ featureId }) => featureId));

export function reconcileFramescaperProjectFeatureRequirementsV24(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV24CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V24 project');
	const manifest = normalizeManifest(candidate);
	assertNoVisualPublisherConflict(manifest);
	const baseline = reconcileFramescaperProjectFeatureRequirementsV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		foundationForV22Requirements(candidate, manifest),
	);
	const owned: ProjectFeatureRequirement[] = [];
	const sources = records(data(candidate, 'sources'), 'sources');
	const clips = records(data(candidate, 'clips'), 'clips');
	if (sources.some(({ kind }) => kind === 'still') || clips.some(({ kind }) => kind === 'still')) {
		owned.push(FRAMESCAPER_V24_VISUAL_REQUIREMENTS.stills);
	}
	if (sources.some(({ kind }) => kind === 'generator') || clips.some(({ kind }) => kind === 'generator')) {
		owned.push(FRAMESCAPER_V24_VISUAL_REQUIREMENTS.generators);
	}
	if (array(candidate, 'videoAdjustmentLayers').length > 0) owned.push(FRAMESCAPER_V24_VISUAL_REQUIREMENTS.adjustmentLayers);
	if (array(candidate, 'videoMaskMattes').length > 0) owned.push(FRAMESCAPER_V24_VISUAL_REQUIREMENTS.masksMattes);
	if (array(candidate, 'videoFreezeFallbacks').length > 0) owned.push(FRAMESCAPER_V24_VISUAL_REQUIREMENTS.freeze);
	return Object.freeze({
		schemaVersion: baseline.schemaVersion,
		requirements: Object.freeze([...baseline.requirements, ...owned]),
	});
}

export function validateFramescaperProjectFeatureRequirementsV24(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV24CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V24 project');
	const actual = normalizeManifest(candidate);
	assertNoVisualPublisherConflict(actual);
	const expected = reconcileFramescaperProjectFeatureRequirementsV24(profile, candidate);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V24 visual requirements do not match owned project state.');
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceV24(profile: unknown) {
	assertFramescaperProjectV24CandidateProfile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (data(candidate, 'schemaVersion', true) !== 24) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV24(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: records(data(candidate, 'sources'), 'sources'),
			clips: records(data(candidate, 'clips'), 'clips'),
			tracks: records(data(candidate, 'tracks'), 'tracks'),
			schemaVersion: 24,
			sampleRate: data(candidate, 'sampleRate'),
			sequences: records(data(candidate, 'sequences'), 'sequences'),
			primarySequenceId: data(candidate, 'primarySequenceId'),
		});
	}
}

export function framescaperProjectFeatureRequirementsForV22FoundationV24(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV24CandidateProfile(profile);
	const manifest = normalizeManifest(record(project, 'Framescaper V24 project'));
	assertNoVisualPublisherConflict(manifest);
	return withoutVisualRequirements(manifest);
}

function foundationForV22Requirements(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	const result = structuredClone(project) as Record<string, unknown>;
	stripVisualState(result);
	result.featureRequirements = withoutVisualRequirements(manifest);
	return result;
}

export function stripVisualState(project: Record<string, unknown>): void {
	project.schemaVersion = 22;
	const visualClipIds = new Set(records(project.clips, 'clips')
		.filter(({ kind }) => kind === 'still' || kind === 'generator').map(({ id }) => String(id)));
	project.sources = records(project.sources, 'sources')
		.filter(({ kind }) => kind !== 'still' && kind !== 'generator');
	project.clips = records(project.clips, 'clips')
		.filter(({ kind }) => kind !== 'still' && kind !== 'generator');
	for (const track of records(project.tracks, 'tracks')) {
		if (!Array.isArray(track.clipIds)) continue;
		track.clipIds = track.clipIds.filter((id) => !visualClipIds.has(String(id)));
	}
	const projectBin = record(project.projectBin, 'projectBin');
	projectBin.clips = records(projectBin.clips, 'projectBin.clips')
		.filter(({ kind }) => kind !== 'still' && kind !== 'generator');
	for (const field of [
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes', 'videoFreezeFallbacks',
	]) delete project[field];
}

function withoutVisualRequirements(manifest: ProjectFeatureRequirementsManifest): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(({ id, featureId }) => (
			!OWNED_IDS.has(id) && !OWNED_FEATURE_IDS.has(featureId)
		))),
	});
}

function assertNoVisualPublisherConflict(manifest: ProjectFeatureRequirementsManifest): void {
	for (const requirement of manifest.requirements) {
		const ownsId = OWNED_IDS.has(requirement.id);
		const ownsFeature = OWNED_FEATURE_IDS.has(requirement.featureId);
		if (ownsId !== ownsFeature || ((ownsId || ownsFeature)
			&& (requirement.disposition !== 'bypass' || requirement.fallback !== null))) {
			throw new TypeError('A publisher visual requirement cannot replace Framescaper ownership.');
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
