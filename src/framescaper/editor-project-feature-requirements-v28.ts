/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../common/editor/project-feature-capability-profile.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../common/editor/project-owned-feature-requirements.ts';
import {
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirement,
	type ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';
import { videoSourceCharacteristicsV25AreReported } from '../common/editor/video-source-professional-characteristics-v25.ts';
import { FRAMESCAPER_V26_OPENFX_REQUIREMENT } from './editor-project-feature-requirements-v26.ts';
import { FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v28.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';

export const FRAMESCAPER_V28_SOURCE_CHARACTERISTICS_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics,
	displayName: 'Probed source characteristics',
	disposition: 'bypass',
	fallback: null,
});

const NATIVE_REQUIREMENTS = Object.freeze([
	FRAMESCAPER_V28_SOURCE_CHARACTERISTICS_REQUIREMENT,
	FRAMESCAPER_V26_OPENFX_REQUIREMENT,
]);

export function reconcileFramescaperProjectFeatureRequirementsV28(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV28Profile(profile);
	const candidate = record(project, 'Framescaper V28 project');
	const actual = normalizeManifest(candidate);
	assertNoNativeRequirementConflict(actual);
	const baseline = framescaperProjectV27FoundationShapeV28(candidate).featureRequirements;
	const requirements = [...baseline.requirements];
	const videoSources = records(candidate.sources, 'sources').filter(({ kind }) => kind === 'video');
	if (videoSources.some(({ characteristics }) => videoSourceCharacteristicsV25AreReported(characteristics))) {
		appendOnce(requirements, FRAMESCAPER_V28_SOURCE_CHARACTERISTICS_REQUIREMENT);
	}
	if (array(candidate, 'ofxEffects').length > 0) appendOnce(requirements, FRAMESCAPER_V26_OPENFX_REQUIREMENT);
	return Object.freeze({ schemaVersion: baseline.schemaVersion, requirements: Object.freeze(requirements) });
}

export function validateFramescaperProjectFeatureRequirementsV28(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV28Profile(profile);
	const candidate = record(project, 'Framescaper V28 project');
	const actual = normalizeManifest(candidate);
	assertNoNativeRequirementConflict(actual);
	const expected = reconcileFramescaperProjectFeatureRequirementsV28(profile, candidate);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V28 feature requirements do not match finishing/native state.');
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceV28(profile: unknown) {
	assertFramescaperProjectV28Profile(profile);
	const definition = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(definition.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(definition.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate(project: unknown) {
		if (!project || typeof project !== 'object' || Array.isArray(project)
			|| (project as Record<string, unknown>).schemaVersion !== 28) return null;
		const candidate = project as Record<string, unknown>;
		return evaluateProjectFeatureRequirements(
			validateFramescaperProjectFeatureRequirementsV28(profile, candidate),
			{
				knownFeatureIds, availableFeatureIds,
				sources: records(candidate.sources, 'sources'),
				clips: records(candidate.clips, 'clips'),
				tracks: records(candidate.tracks, 'tracks'),
				schemaVersion: 28,
				sampleRate: candidate.sampleRate,
				sequences: records(candidate.sequences, 'sequences'),
				primarySequenceId: candidate.primarySequenceId,
			},
		);
	} });
}

function appendOnce(rows: ProjectFeatureRequirement[], requirement: ProjectFeatureRequirement): void {
	if (!rows.some(({ id, featureId }) => id === requirement.id || featureId === requirement.featureId)) {
		rows.push(requirement);
	}
}

function assertNoNativeRequirementConflict(manifest: ProjectFeatureRequirementsManifest): void {
	for (const row of manifest.requirements) {
		for (const owned of NATIVE_REQUIREMENTS) {
			const ownsId = row.id === owned.id;
			const ownsFeature = row.featureId === owned.featureId;
			if (ownsId !== ownsFeature || ((ownsId || ownsFeature) && JSON.stringify(row) !== JSON.stringify(owned))) {
				throw new TypeError('A publisher requirement cannot replace Framescaper V28 native ownership.');
			}
		}
	}
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(project.featureRequirements, {
		sources: records(project.sources, 'sources'), clips: records(project.clips, 'clips'),
		tracks: records(project.tracks, 'tracks'), schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate, sequences: records(project.sequences, 'sequences'),
		primarySequenceId: project.primarySequenceId,
	});
}

function array(value: Record<string, unknown>, key: string): unknown[] {
	if (!Array.isArray(value[key])) throw new TypeError(`${key} must be an array.`);
	return value[key] as unknown[];
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
