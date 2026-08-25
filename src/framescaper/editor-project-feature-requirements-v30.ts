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
import { FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v30.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';

export const FRAMESCAPER_V30_TIMELINE_IMAGES_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineImages,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
	displayName: 'Timeline images',
	disposition: 'bypass',
	fallback: null,
});

export function reconcileFramescaperProjectFeatureRequirementsV30(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV30Profile(profile);
	const candidate = record(project, 'Framescaper V30 project');
	const actual = normalizeManifest(candidate);
	assertNoImageRequirementConflict(actual);
	const baseline = framescaperProjectV28FoundationShapeV30(candidate).featureRequirements;
	const requirements = [...baseline.requirements];
	if (records(candidate.sources, 'sources').some(({ kind }) => kind === 'image')) {
		requirements.push(FRAMESCAPER_V30_TIMELINE_IMAGES_REQUIREMENT);
	}
	return Object.freeze({ schemaVersion: baseline.schemaVersion, requirements: Object.freeze(requirements) });
}

export function validateFramescaperProjectFeatureRequirementsV30(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV30Profile(profile);
	const candidate = record(project, 'Framescaper V30 project');
	const actual = normalizeManifest(candidate);
	assertNoImageRequirementConflict(actual);
	const expected = reconcileFramescaperProjectFeatureRequirementsV30(profile, candidate);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V30 feature requirements do not match timeline-image state.');
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceV30(profile: unknown) {
	assertFramescaperProjectV30Profile(profile);
	const definition = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(definition.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(definition.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate(project: unknown) {
		if (!project || typeof project !== 'object' || Array.isArray(project)
			|| (project as Record<string, unknown>).schemaVersion !== 30) return null;
		const candidate = project as Record<string, unknown>;
		return evaluateProjectFeatureRequirements(
			validateFramescaperProjectFeatureRequirementsV30(profile, candidate),
			{
				knownFeatureIds, availableFeatureIds,
				sources: records(candidate.sources, 'sources'),
				clips: records(candidate.clips, 'clips'),
				tracks: records(candidate.tracks, 'tracks'),
				schemaVersion: 30,
				sampleRate: candidate.sampleRate,
				sequences: records(candidate.sequences, 'sequences'),
				primarySequenceId: candidate.primarySequenceId,
			},
		);
	} });
}

function assertNoImageRequirementConflict(manifest: ProjectFeatureRequirementsManifest): void {
	for (const row of manifest.requirements) {
		const ownsId = row.id === FRAMESCAPER_V30_TIMELINE_IMAGES_REQUIREMENT.id;
		const ownsFeature = row.featureId === FRAMESCAPER_V30_TIMELINE_IMAGES_REQUIREMENT.featureId;
		if (ownsId !== ownsFeature || ((ownsId || ownsFeature)
			&& JSON.stringify(row) !== JSON.stringify(FRAMESCAPER_V30_TIMELINE_IMAGES_REQUIREMENT))) {
			throw new TypeError('A publisher requirement cannot replace Framescaper V30 image ownership.');
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

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
