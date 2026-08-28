/* SPDX-License-Identifier: AGPL-3.0-only */

import { editorProjectFeatureCapabilityProfileDefinition } from '../common/editor/project-feature-capability-profile.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
	reconcileProjectOwnedAssistanceRequirement,
} from '../common/editor/project-owned-feature-requirements.ts';
import {
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';
import {
	FRAMESCAPER_ASSISTANCE_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-assistance.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import {
	assertFramescaperProjectAssistanceProfile,
} from './editor-domain-runtime-profile.ts';

const LABEL = 'Framescaper assistance project';
const MAXIMUM_INHERITED_CANONICALIZATION_PASSES = 8;

/** Reconcile inherited timelineImage image state first, then append assistance's assistance requirement. */
export function reconcileFramescaperProjectFeatureRequirementsAssistance(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectAssistanceProfile(profile);
	const candidate = record(project, LABEL);
	const actual = normalizeManifest(candidate);
	const common = reconcileProjectOwnedAssistanceRequirement(candidate, actual);
	const inherited = canonicalInheritedRequirements(candidate, common);
	const assistance = common.requirements.filter(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.assistanceAssets
	));
	return Object.freeze({
		schemaVersion: inherited.schemaVersion,
		requirements: Object.freeze([...inherited.requirements, ...assistance]),
	});
}

function canonicalInheritedRequirements(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	let inherited = framescaperProjectTimelineImageFoundationShapeAssistance({
		...project, featureRequirements: manifest,
	}).featureRequirements;
	for (let pass = 0; pass < MAXIMUM_INHERITED_CANONICALIZATION_PASSES; pass += 1) {
		const next = framescaperProjectTimelineImageFoundationShapeAssistance({
			...project, featureRequirements: inherited,
		}).featureRequirements;
		if (JSON.stringify(next) === JSON.stringify(inherited)) return inherited;
		inherited = next;
	}
	throw new Error(`${LABEL} inherited feature requirements did not converge.`);
}

export function validateFramescaperProjectFeatureRequirementsAssistance(
	profile: unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectAssistanceProfile(profile);
	const candidate = record(project, LABEL);
	const actual = normalizeManifest(candidate);
	const expected = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, candidate);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`${LABEL} feature requirements do not match inherited and assistance state.`);
	}
	return actual;
}

export function createFramescaperProjectFeatureCompatibilityServiceAssistance(profile: unknown) {
	assertFramescaperProjectAssistanceProfile(profile);
	const definition = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_ASSISTANCE_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(definition.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(definition.registrations
		.filter(({ available }) => available).map(({ featureId }) => featureId));
	return Object.freeze({ evaluate(project: unknown) {
		if (!project || typeof project !== 'object' || Array.isArray(project)
			|| (project as Record<string, unknown>).schemaFamily !== 'framescaper'
			|| (project as Record<string, unknown>).schemaVersion !== 1) return null;
		const candidate = project as Record<string, unknown>;
		return evaluateProjectFeatureRequirements(
			validateFramescaperProjectFeatureRequirementsAssistance(profile, candidate),
			{ ...context(candidate), knownFeatureIds, availableFeatureIds },
		);
	} });
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(project.featureRequirements, context(project));
}

function context(
	project: Record<string, unknown>,
) {
	return {
		sources: records(project.sources, 'sources'),
		clips: records(project.clips, 'clips'),
		tracks: records(project.tracks, 'tracks'),
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences: records(project.sequences, 'sequences'),
		primarySequenceId: project.primarySequenceId,
	};
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
