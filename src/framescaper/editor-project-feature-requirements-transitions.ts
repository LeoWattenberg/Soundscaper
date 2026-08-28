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
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from './editor-project-feature-requirements-retime.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-transitions.ts';
import { assertFramescaperProjectTransitionsCandidateProfile } from './editor-domain-runtime-profile.ts';

const TRANSITION_REQUIREMENT_PREFIX = 'framescaper.video-transition';
const TRANSITION_FEATURE_PREFIX = 'org.soundscaper.capability.video-transition';

/** Reconcile retime ownership and the complete transitions transition inventory. */
export function reconcileFramescaperProjectFeatureRequirementsTransitions(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	const candidate = record(project, 'Framescaper transitions project');
	const supplied = normalizeManifest(candidate);
	assertNoTransitionPublisherConflict(supplied);
	const baseline = reconcileFramescaperProjectFeatureRequirementsRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		foundationForRetimeRequirements(candidate, supplied),
	);
	const owned = videoTransitionFeatureRequirementsV1(allTransitions(candidate));
	return Object.freeze({
		schemaVersion: baseline.schemaVersion,
		requirements: Object.freeze([...baseline.requirements, ...owned]),
	});
}

export function validateFramescaperProjectFeatureRequirementsTransitions(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	const candidate = record(project, 'Framescaper transitions project');
	const manifest = normalizeManifest(candidate);
	assertNoTransitionPublisherConflict(manifest);
	const expected = reconcileFramescaperProjectFeatureRequirementsTransitions(profile, candidate);
	if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
		throw new TypeError('Framescaper transitions transition requirements do not match owned project state.');
	}
	return manifest;
}

/** Remove only transitions-owned declarations for a transient exact-retime projection. */
export function framescaperProjectFeatureRequirementsForRetimeFoundationTransitions(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	const manifest = normalizeManifest(record(project, 'Framescaper transitions project'));
	assertNoTransitionPublisherConflict(manifest);
	return withoutTransitionRequirements(manifest);
}

export function createFramescaperProjectFeatureCompatibilityServiceTransitions(profile: unknown) {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (data(candidate, 'schemaFamily', true) !== 'framescaper'
			|| data(candidate, 'schemaVersion', true) !== 1) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsTransitions(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: records(data(candidate, 'sources'), 'sources'),
			clips: records(data(candidate, 'clips'), 'clips'),
			tracks: records(data(candidate, 'tracks'), 'tracks'),
			schemaVersion:  1,
			sampleRate: data(candidate, 'sampleRate'),
			sequences: records(data(candidate, 'sequences'), 'sequences'),
			primarySequenceId: data(candidate, 'primarySequenceId'),
		});
	}
}

function foundationForRetimeRequirements(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	const result = structuredClone(project) as Record<string, unknown>;
	result.schemaVersion =  1;
	result.featureRequirements = withoutTransitionRequirements(manifest);
	for (const track of records(result.tracks, 'tracks')) delete track.videoTransitions;
	return result;
}

function allTransitions(project: Record<string, unknown>): unknown[] {
	return records(data(project, 'tracks'), 'tracks').flatMap((track) => {
		if (data(track, 'type') !== 'video') return [];
		const value = data(track, 'videoTransitions');
		if (!Array.isArray(value)) throw new TypeError('A transitions video track requires videoTransitions.');
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
