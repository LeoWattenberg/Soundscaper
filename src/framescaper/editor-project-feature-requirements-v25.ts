/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../common/editor/project-owned-feature-requirements.ts';
import {
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirement,
	type ProjectFeatureRequirementsManifest,
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts';
import { projectHasReportedSourceCharacteristics } from '../common/editor/source-characteristics-v14.ts';
import {
	videoSourceCharacteristicsV25AreReported,
} from '../common/editor/video-source-professional-characteristics-v25.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import { FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v25.ts';
import { framescaperProjectV24FoundationShapeV25 } from './editor-project-v25-foundation.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';

const SOURCE_CHARACTERISTICS_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics,
	displayName: 'Probed source characteristics',
	disposition: 'bypass',
	fallback: null,
});

export function reconcileFramescaperProjectFeatureRequirementsV25(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV25CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V25 project');
	const manifest = normalizeManifest(candidate);
	assertOwnedRequirement(manifest);
	const baseline = v24Requirements(candidate, manifest);
	const publisherOwnsFeature = baseline.requirements.some(({ id, featureId }) => (
		id !== SOURCE_CHARACTERISTICS_REQUIREMENT.id
		&& featureId === SOURCE_CHARACTERISTICS_REQUIREMENT.featureId
	));
	const requiresCharacteristics = records(data(candidate, 'sources'), 'sources').some((source) => (
		source.kind === 'video' && videoSourceCharacteristicsV25AreReported(source.characteristics)
	));
	const requirements = baseline.requirements.filter(({ id }) => id !== SOURCE_CHARACTERISTICS_REQUIREMENT.id);
	if (requiresCharacteristics && !publisherOwnsFeature) requirements.push(SOURCE_CHARACTERISTICS_REQUIREMENT);
	return Object.freeze({
		schemaVersion: baseline.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

export function validateFramescaperProjectFeatureRequirementsV25(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV25CandidateProfile(profile);
	const actual = normalizeManifest(record(project, 'Framescaper V25 project'));
	assertOwnedRequirement(actual);
	const expected = reconcileFramescaperProjectFeatureRequirementsV25(profile, project);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V25 source-characteristics requirements do not match owned state.');
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceV25(profile: unknown) {
	assertFramescaperProjectV25CandidateProfile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V25_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (data(candidate, 'schemaVersion', true) !== 25) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV25(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: records(data(candidate, 'sources'), 'sources'),
			clips: records(data(candidate, 'clips'), 'clips'),
			tracks: records(data(candidate, 'tracks'), 'tracks'),
			schemaVersion: 25,
			sampleRate: data(candidate, 'sampleRate'),
			sequences: records(data(candidate, 'sequences'), 'sequences'),
			primarySequenceId: data(candidate, 'primarySequenceId'),
		});
	}
}

export function framescaperProjectFeatureRequirementsForV24FoundationV25(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV25CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V25 project');
	return v24Requirements(candidate, normalizeManifest(candidate));
}

function v24Requirements(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	const foundation = framescaperProjectV24FoundationShapeV25(project);
	const publisherOwnsFeature = manifest.requirements.some(({ id, featureId }) => (
		id !== SOURCE_CHARACTERISTICS_REQUIREMENT.id
		&& featureId === SOURCE_CHARACTERISTICS_REQUIREMENT.featureId
	));
	const requirements = withoutOwnedRequirement(manifest).requirements.slice();
	if (projectHasReportedSourceCharacteristics(foundation) && !publisherOwnsFeature) {
		requirements.push(SOURCE_CHARACTERISTICS_REQUIREMENT);
	}
	foundation.featureRequirements = Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
	return reconcileFramescaperProjectFeatureRequirementsV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		foundation,
	);
}

function withoutOwnedRequirement(
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			({ id }) => id !== SOURCE_CHARACTERISTICS_REQUIREMENT.id,
		)),
	});
}

function assertOwnedRequirement(manifest: ProjectFeatureRequirementsManifest): void {
	const owned = manifest.requirements.find(({ id }) => id === SOURCE_CHARACTERISTICS_REQUIREMENT.id);
	if (owned && JSON.stringify(owned) !== JSON.stringify(SOURCE_CHARACTERISTICS_REQUIREMENT)) {
		throw new TypeError('A publisher source-characteristics requirement cannot replace Framescaper ownership.');
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

function data(value: Record<string, unknown>, key: string, optional = false): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) {
		if (optional) return undefined;
		throw new TypeError(`${key} must be data.`);
	}
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be data.`);
	return descriptor.value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
