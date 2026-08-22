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
	reconcileFramescaperProjectFeatureRequirementsV25,
} from './editor-project-feature-requirements-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v26.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';

export const FRAMESCAPER_V26_OPENFX_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: 'framescaper.openfx-effects',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.ofxEffects,
	displayName: 'OpenFX effects',
	disposition: 'bypass',
	fallback: null,
});

export function reconcileFramescaperProjectFeatureRequirementsV26(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV26CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V26 project');
	const manifest = normalizeManifest(candidate);
	assertNoPublisherConflict(manifest);
	const baseline = reconcileFramescaperProjectFeatureRequirementsV25(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		foundationForV25(candidate, manifest),
	);
	const effects = array(candidate, 'ofxEffects');
	return Object.freeze({
		schemaVersion: baseline.schemaVersion,
		requirements: Object.freeze(effects.length === 0
			? [...baseline.requirements]
			: [...baseline.requirements, FRAMESCAPER_V26_OPENFX_REQUIREMENT]),
	});
}

export function validateFramescaperProjectFeatureRequirementsV26(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV26CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V26 project');
	const actual = normalizeManifest(candidate);
	assertNoPublisherConflict(actual);
	const expected = reconcileFramescaperProjectFeatureRequirementsV26(profile, candidate);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V26 OpenFX requirements do not match owned effect state.');
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceV26(profile: unknown) {
	assertFramescaperProjectV26CandidateProfile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (data(candidate, 'schemaVersion', true) !== 26) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV26(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: records(data(candidate, 'sources'), 'sources'),
			clips: records(data(candidate, 'clips'), 'clips'),
			tracks: records(data(candidate, 'tracks'), 'tracks'),
			schemaVersion: 26,
			sampleRate: data(candidate, 'sampleRate'),
			sequences: records(data(candidate, 'sequences'), 'sequences'),
			primarySequenceId: data(candidate, 'primarySequenceId'),
		});
	}
}

export function framescaperProjectFeatureRequirementsForV25FoundationV26(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV26CandidateProfile(profile);
	const manifest = normalizeManifest(record(project, 'Framescaper V26 project'));
	assertNoPublisherConflict(manifest);
	return withoutOpenFx(manifest);
}

function foundationForV25(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	const foundation = structuredClone(project) as Record<string, unknown>;
	foundation.schemaVersion = 25;
	delete foundation.ofxEffects;
	foundation.featureRequirements = withoutOpenFx(manifest);
	return foundation;
}

function withoutOpenFx(manifest: ProjectFeatureRequirementsManifest): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(({ id, featureId }) => (
			id !== FRAMESCAPER_V26_OPENFX_REQUIREMENT.id
			&& featureId !== FRAMESCAPER_V26_OPENFX_REQUIREMENT.featureId
		))),
	});
}

function assertNoPublisherConflict(manifest: ProjectFeatureRequirementsManifest): void {
	for (const requirement of manifest.requirements) {
		const ownsId = requirement.id === FRAMESCAPER_V26_OPENFX_REQUIREMENT.id;
		const ownsFeature = requirement.featureId === FRAMESCAPER_V26_OPENFX_REQUIREMENT.featureId;
		if (ownsId !== ownsFeature || ((ownsId || ownsFeature)
			&& JSON.stringify(requirement) !== JSON.stringify(FRAMESCAPER_V26_OPENFX_REQUIREMENT))) {
			throw new TypeError('A publisher OpenFX requirement cannot replace Framescaper ownership.');
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

function data(value: Record<string, unknown>, key: string, optional = false): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) {
		if (optional) return undefined;
		throw new TypeError(`${key} must be an own enumerable data property.`);
	}
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
	const result = data(value, key);
	if (!Array.isArray(result)) throw new TypeError(`${key} must be an array.`);
	return result;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
