/* SPDX-License-Identifier: AGPL-3.0-only */

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
	videoTransitionFeatureRequirementsV1,
} from '../common/editor/video-transition-registry.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from './editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v22.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';

const TRANSITION_REQUIREMENT_PREFIX = 'framescaper.video-transition';
const TRANSITION_FEATURE_PREFIX = 'org.soundscaper.capability.video-transition';

/** Reconcile V20 ownership and the complete V22 transition inventory. */
export function reconcileFramescaperProjectFeatureRequirementsV22(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV22CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V22 project');
	const supplied = normalizeManifest(candidate);
	assertNoTransitionPublisherConflict(supplied);
	const baseline = reconcileFramescaperProjectFeatureRequirementsV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		foundationForV20Requirements(candidate, supplied),
	);
	const owned = videoTransitionFeatureRequirementsV1(allTransitions(candidate));
	return Object.freeze({
		schemaVersion: baseline.schemaVersion,
		requirements: Object.freeze([...baseline.requirements, ...owned]),
	});
}

export function validateFramescaperProjectFeatureRequirementsV22(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV22CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V22 project');
	const manifest = normalizeManifest(candidate);
	assertNoTransitionPublisherConflict(manifest);
	const expected = reconcileFramescaperProjectFeatureRequirementsV22(profile, candidate);
	if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper V22 transition requirements do not match owned project state.');
	}
	return manifest;
}

/** Remove only V22-owned declarations for a transient exact-V20 projection. */
export function framescaperProjectFeatureRequirementsForV20FoundationV22(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV22CandidateProfile(profile);
	const manifest = normalizeManifest(record(project, 'Framescaper V22 project'));
	assertNoTransitionPublisherConflict(manifest);
	return withoutTransitionRequirements(manifest);
}

export function createFramescaperProjectFeatureCompatibilityServiceV22(profile: unknown) {
	assertFramescaperProjectV22CandidateProfile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (data(candidate, 'schemaVersion', true) !== 22) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV22(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: records(data(candidate, 'sources'), 'sources'),
			clips: records(data(candidate, 'clips'), 'clips'),
			tracks: records(data(candidate, 'tracks'), 'tracks'),
			schemaVersion: 22,
			sampleRate: data(candidate, 'sampleRate'),
			sequences: records(data(candidate, 'sequences'), 'sequences'),
			primarySequenceId: data(candidate, 'primarySequenceId'),
		});
	}
}

function foundationForV20Requirements(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	const result = structuredClone(project) as Record<string, unknown>;
	result.schemaVersion = 20;
	result.featureRequirements = withoutTransitionRequirements(manifest);
	for (const track of records(result.tracks, 'tracks')) delete track.videoTransitions;
	return result;
}

function allTransitions(project: Record<string, unknown>): unknown[] {
	return records(data(project, 'tracks'), 'tracks').flatMap((track) => {
		if (data(track, 'type') !== 'video') return [];
		const value = data(track, 'videoTransitions');
		if (!Array.isArray(value)) throw new TypeError('A V22 video track requires videoTransitions.');
		return value;
	});
}

function withoutTransitionRequirements(
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter((requirement) => (
			!isTransitionRequirement(requirement)
		))),
	});
}

function assertNoTransitionPublisherConflict(manifest: ProjectFeatureRequirementsManifest): void {
	const supplied = manifest.requirements.filter(isTransitionRequirement);
	for (const requirement of supplied) {
		if (!requirement.id.startsWith(TRANSITION_REQUIREMENT_PREFIX)
			|| !requirement.featureId.startsWith(TRANSITION_FEATURE_PREFIX)
			|| requirement.disposition !== 'bypass' || requirement.fallback !== null) {
			throw new TypeError('A publisher transition requirement cannot replace Framescaper ownership.');
		}
	}
	for (const requirement of manifest.requirements) {
		if (!requirement.id.startsWith(TRANSITION_REQUIREMENT_PREFIX)
			&& requirement.featureId.startsWith(TRANSITION_FEATURE_PREFIX)) {
			throw new TypeError('A publisher transition feature substitution is forbidden.');
		}
	}
}

function isTransitionRequirement(requirement: ProjectFeatureRequirement): boolean {
	return requirement.id.startsWith(TRANSITION_REQUIREMENT_PREFIX)
		|| requirement.featureId.startsWith(TRANSITION_FEATURE_PREFIX);
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
