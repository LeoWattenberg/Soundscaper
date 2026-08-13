/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	type ProjectFeatureRequirement,
	type ProjectFeatureRequirementsManifest,
	type ProjectFeatureRequirementsReport,
} from '../common/editor/project-feature-requirements.ts';
import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';

export const FRAMESCAPER_NESTED_SEQUENCES_FEATURE_ID =
	'org.soundscaper.capability.nested-sequences' as const;

export const FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_V18 = Object.freeze({
	id: 'framescaper.nested-sequences',
	featureId: FRAMESCAPER_NESTED_SEQUENCES_FEATURE_ID,
	displayName: 'Nested sequences',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export const FRAMESCAPER_VIDEO_PROXY_FEATURE_ID =
	'org.soundscaper.capability.video-proxy' as const;

export const FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 = Object.freeze({
	id: 'framescaper.video-proxy',
	featureId: FRAMESCAPER_VIDEO_PROXY_FEATURE_ID,
	displayName: 'Video proxy attachments',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export interface FramescaperProjectFeatureCompatibilityServiceV18 {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null;
}

interface OwnedFeatureV18 {
	readonly requirement: ProjectFeatureRequirement;
	readonly statePresent: (project: Record<string, unknown>) => boolean;
	readonly missingMessage: string;
	readonly strayMessage: string;
	readonly conflictName: string;
}

const OWNED_FEATURES_V18: readonly OwnedFeatureV18[] = Object.freeze([
	Object.freeze({
		requirement: FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_V18,
		statePresent: projectHasNestedSequences,
		missingMessage: 'A nested Framescaper V18 project requires framescaper.nested-sequences.',
		strayMessage: 'An unnested Framescaper V18 project must not retain framescaper.nested-sequences.',
		conflictName: 'nested-sequences',
	}),
	Object.freeze({
		requirement: FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
		statePresent: projectHasProxyAttachment,
		missingMessage: 'An attached Framescaper V18 project requires framescaper.video-proxy.',
		strayMessage: 'An all-null Framescaper V18 project must not retain framescaper.video-proxy.',
		conflictName: 'video-proxy',
	}),
]);

const OWNED_REQUIREMENT_IDS_V18 = new Set(
	OWNED_FEATURES_V18.map(({ requirement }) => requirement.id),
);

/** Reconcile exact V18 owned declarations from persisted product state. */
export function reconcileFramescaperProjectFeatureRequirementsV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV18Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V18 project');
	const manifest = normalizeManifest(candidate);
	const ownership = OWNED_FEATURES_V18.map((owned) => ({
		owned,
		present: owned.statePresent(candidate),
		index: assertNoOwnedRequirementConflict(manifest, owned),
	}));
	if (ownership.every(({ present, index }) => present === (index >= 0))) return manifest;

	const requirements = manifest.requirements.filter(
		(requirement) => !OWNED_REQUIREMENT_IDS_V18.has(requirement.id),
	);
	for (const { owned, present } of ownership) {
		if (!present) continue;
		if (requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
			throw new RangeError('Framescaper V18 owned requirements exceed the manifest limit.');
		}
		requirements.push(owned.requirement);
	}
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

/** Validate that persisted V18 feature ownership already matches product state. */
export function validateFramescaperProjectFeatureRequirementsV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV18Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V18 project');
	const manifest = normalizeManifest(candidate);
	for (const owned of OWNED_FEATURES_V18) {
		const present = owned.statePresent(candidate);
		const ownedIndex = assertNoOwnedRequirementConflict(manifest, owned);
		if (present && ownedIndex < 0) throw new TypeError(owned.missingMessage);
		if (!present && ownedIndex >= 0) throw new TypeError(owned.strayMessage);
	}
	return manifest;
}

/** Remove the V18-only declaration from the unchanged V17 validation view. */
export function framescaperProjectFeatureRequirementsForV17Foundation(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV18Profile(profile);
	const manifest = normalizeManifest(dataRecord(project, 'Framescaper V18 project'));
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			(requirement) => !OWNED_REQUIREMENT_IDS_V18.has(requirement.id),
		)),
	});
}

/** Snapshot the authenticated private registry for exact-schema compatibility. */
export function createFramescaperProjectFeatureCompatibilityServiceV18(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperProjectFeatureCompatibilityServiceV18 {
	assertFramescaperProjectV18Profile(profile);
	const runtime = editorProjectRuntimeProfileDefinition(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(runtime.capabilityProfile);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available)
		.map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (project === null || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (optionalDataProperty(candidate, 'schemaVersion', 'Framescaper project') !== 18) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV18(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: dataArray(candidate, 'sources', 'Framescaper project'),
			clips: dataArray(candidate, 'clips', 'Framescaper project'),
			tracks: dataArray(candidate, 'tracks', 'Framescaper project'),
			schemaVersion: 18,
			sampleRate: dataProperty(candidate, 'sampleRate', 'Framescaper project'),
			sequences: dataArray(candidate, 'sequences', 'Framescaper project'),
			primarySequenceId: dataProperty(candidate, 'primarySequenceId', 'Framescaper project'),
		});
	}
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(
		dataProperty(project, 'featureRequirements', 'Framescaper V18 project'),
		{
			sources: dataArray(project, 'sources', 'Framescaper V18 project'),
			clips: dataArray(project, 'clips', 'Framescaper V18 project'),
			tracks: dataArray(project, 'tracks', 'Framescaper V18 project'),
			schemaVersion: dataProperty(project, 'schemaVersion', 'Framescaper V18 project'),
			sampleRate: dataProperty(project, 'sampleRate', 'Framescaper V18 project'),
			sequences: dataArray(project, 'sequences', 'Framescaper V18 project'),
			primarySequenceId: dataProperty(project, 'primarySequenceId', 'Framescaper V18 project'),
		},
	);
}

function assertNoOwnedRequirementConflict(
	manifest: ProjectFeatureRequirementsManifest,
	owned: OwnedFeatureV18,
): number {
	const expected = owned.requirement;
	const ownedIndex = manifest.requirements.findIndex(
		(requirement) => requirement.id === expected.id,
	);
	if (ownedIndex >= 0 && !ownedRequirementMatches(manifest.requirements[ownedIndex], expected)) {
		throw new TypeError(
			`The reserved Framescaper ${owned.conflictName} requirement conflicts with publisher data.`,
		);
	}
	if (manifest.requirements.some((requirement) => (
		requirement.id !== expected.id
		&& requirement.featureId === expected.featureId
	))) {
		throw new TypeError(
			`A publisher ${owned.conflictName} substitution cannot replace Framescaper ownership.`,
		);
	}
	return ownedIndex;
}

function ownedRequirementMatches(
	requirement: ProjectFeatureRequirement | undefined,
	expected: ProjectFeatureRequirement,
): boolean {
	return Boolean(
		requirement
		&& requirement.featureId === expected.featureId
		&& requirement.displayName === expected.displayName
		&& requirement.disposition === expected.disposition
		&& requirement.fallback === null,
	);
}

function projectHasNestedSequences(project: Record<string, unknown>): boolean {
	return dataArray(project, 'subsequences', 'Framescaper V18 project').length > 0;
}

function projectHasProxyAttachment(project: Record<string, unknown>): boolean {
	for (const [index, value] of dataArray(project, 'sources', 'Framescaper V18 project').entries()) {
		const source = dataRecord(value, `Framescaper V18 project.sources[${String(index)}]`);
		if (dataProperty(source, 'kind', `Framescaper V18 project.sources[${String(index)}]`) !== 'video') continue;
		if (dataProperty(source, 'proxyAttachment', `Framescaper V18 project.sources[${String(index)}]`) !== null) {
			return true;
		}
	}
	return false;
}

function dataArray(
	value: Record<string, unknown>,
	key: string,
	name: string,
): readonly Record<string, unknown>[] {
	const candidate = dataProperty(value, key, name);
	if (!Array.isArray(candidate)) throw new TypeError(`${name}.${key} must be an array.`);
	return candidate as readonly Record<string, unknown>[];
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
