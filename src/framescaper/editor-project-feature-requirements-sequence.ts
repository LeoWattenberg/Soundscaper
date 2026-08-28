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
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';

export const FRAMESCAPER_MULTICAMERA_FEATURE_ID =
	'org.soundscaper.capability.multicamera' as const;

export const FRAMESCAPER_MULTICAMERA_REQUIREMENT_SEQUENCE = Object.freeze({
	id: 'framescaper.multicamera',
	featureId: FRAMESCAPER_MULTICAMERA_FEATURE_ID,
	displayName: 'Multicamera groups',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export const FRAMESCAPER_NESTED_SEQUENCES_FEATURE_ID =
	'org.soundscaper.capability.nested-sequences' as const;

export const FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_SEQUENCE = Object.freeze({
	id: 'framescaper.nested-sequences',
	featureId: FRAMESCAPER_NESTED_SEQUENCES_FEATURE_ID,
	displayName: 'Nested sequences',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export const FRAMESCAPER_VIDEO_PROXY_FEATURE_ID =
	'org.soundscaper.capability.video-proxy' as const;

export const FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_SEQUENCE = Object.freeze({
	id: 'framescaper.video-proxy',
	featureId: FRAMESCAPER_VIDEO_PROXY_FEATURE_ID,
	displayName: 'Video proxy attachments',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export interface FramescaperProjectFeatureCompatibilityServiceSequence {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null;
}

interface OwnedFeatureSequence {
	readonly requirement: ProjectFeatureRequirement;
	readonly statePresent: (project: Record<string, unknown>) => boolean;
	readonly missingMessage: string;
	readonly strayMessage: string;
	readonly conflictName: string;
}

const OWNED_FEATURES_SEQUENCE: readonly OwnedFeatureSequence[] = Object.freeze([
	Object.freeze({
		requirement: FRAMESCAPER_MULTICAMERA_REQUIREMENT_SEQUENCE,
		statePresent: projectHasMulticameraGroups,
		missingMessage: 'A multicamera Framescaper sequence project requires framescaper.multicamera.',
		strayMessage: 'A non-multicamera Framescaper sequence project must not retain framescaper.multicamera.',
		conflictName: 'multicamera',
	}),
	Object.freeze({
		requirement: FRAMESCAPER_NESTED_SEQUENCES_REQUIREMENT_SEQUENCE,
		statePresent: projectHasNestedSequences,
		missingMessage: 'A nested Framescaper sequence project requires framescaper.nested-sequences.',
		strayMessage: 'An unnested Framescaper sequence project must not retain framescaper.nested-sequences.',
		conflictName: 'nested-sequences',
	}),
	Object.freeze({
		requirement: FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_SEQUENCE,
		statePresent: projectHasProxyAttachment,
		missingMessage: 'An attached Framescaper sequence project requires framescaper.video-proxy.',
		strayMessage: 'An all-null Framescaper sequence project must not retain framescaper.video-proxy.',
		conflictName: 'video-proxy',
	}),
]);

const OWNED_REQUIREMENT_IDS_SEQUENCE = new Set(
	OWNED_FEATURES_SEQUENCE.map(({ requirement }) => requirement.id),
);

/** Reconcile exact sequence owned declarations from persisted product state. */
export function reconcileFramescaperProjectFeatureRequirementsSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectSequenceProfile(profile);
	const candidate = dataRecord(project, 'Framescaper sequence project');
	const manifest = normalizeManifest(candidate);
	const ownership = OWNED_FEATURES_SEQUENCE.map((owned) => ({
		owned,
		present: owned.statePresent(candidate),
		index: assertNoOwnedRequirementConflict(manifest, owned),
	}));
	if (ownership.every(({ present, index }) => present === (index >= 0))) return manifest;

	const requirements = manifest.requirements.filter(
		(requirement) => !OWNED_REQUIREMENT_IDS_SEQUENCE.has(requirement.id),
	);
	for (const { owned, present } of ownership) {
		if (!present) continue;
		if (requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
			throw new RangeError('Framescaper sequence owned requirements exceed the manifest limit.');
		}
		requirements.push(owned.requirement);
	}
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

/** Validate that persisted sequence feature ownership already matches product state. */
export function validateFramescaperProjectFeatureRequirementsSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectSequenceProfile(profile);
	const candidate = dataRecord(project, 'Framescaper sequence project');
	const manifest = normalizeManifest(candidate);
	for (const owned of OWNED_FEATURES_SEQUENCE) {
		const present = owned.statePresent(candidate);
		const ownedIndex = assertNoOwnedRequirementConflict(manifest, owned);
		if (present && ownedIndex < 0) throw new TypeError(owned.missingMessage);
		if (!present && ownedIndex >= 0) throw new TypeError(owned.strayMessage);
	}
	return manifest;
}

/** Remove the sequence-only declaration from the unchanged V17 validation view. */
export function framescaperProjectFeatureRequirementsForV17Foundation(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectSequenceProfile(profile);
	const manifest = normalizeManifest(dataRecord(project, 'Framescaper sequence project'));
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			(requirement) => !OWNED_REQUIREMENT_IDS_SEQUENCE.has(requirement.id),
		)),
	});
}

/** Snapshot the authenticated private registry for exact-schema compatibility. */
export function createFramescaperProjectFeatureCompatibilityServiceSequence(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperProjectFeatureCompatibilityServiceSequence {
	assertFramescaperProjectSequenceProfile(profile);
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
		if (optionalDataProperty(candidate, 'schemaFamily', 'Framescaper project') !== 'framescaper'
			|| optionalDataProperty(candidate, 'schemaVersion', 'Framescaper project') !== 1) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsSequence(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: dataArray(candidate, 'sources', 'Framescaper project'),
			clips: dataArray(candidate, 'clips', 'Framescaper project'),
			tracks: dataArray(candidate, 'tracks', 'Framescaper project'),
			schemaVersion:  1,
			sampleRate: dataProperty(candidate, 'sampleRate', 'Framescaper project'),
			sequences: dataArray(candidate, 'sequences', 'Framescaper project'),
			primarySequenceId: dataProperty(candidate, 'primarySequenceId', 'Framescaper project'),
		});
	}
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(
		dataProperty(project, 'featureRequirements', 'Framescaper sequence project'),
		{
			sources: dataArray(project, 'sources', 'Framescaper sequence project'),
			clips: dataArray(project, 'clips', 'Framescaper sequence project'),
			tracks: dataArray(project, 'tracks', 'Framescaper sequence project'),
			schemaVersion: dataProperty(project, 'schemaVersion', 'Framescaper sequence project'),
			sampleRate: dataProperty(project, 'sampleRate', 'Framescaper sequence project'),
			sequences: dataArray(project, 'sequences', 'Framescaper sequence project'),
			primarySequenceId: dataProperty(project, 'primarySequenceId', 'Framescaper sequence project'),
		},
	);
}

function assertNoOwnedRequirementConflict(
	manifest: ProjectFeatureRequirementsManifest,
	owned: OwnedFeatureSequence,
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
	return dataArray(project, 'subsequences', 'Framescaper sequence project').length > 0;
}

function projectHasMulticameraGroups(project: Record<string, unknown>): boolean {
	return dataArray(project, 'multicameraGroups', 'Framescaper sequence project').length > 0;
}

function projectHasProxyAttachment(project: Record<string, unknown>): boolean {
	for (const [index, value] of dataArray(project, 'sources', 'Framescaper sequence project').entries()) {
		const source = dataRecord(value, `Framescaper sequence project.sources[${String(index)}]`);
		if (dataProperty(source, 'kind', `Framescaper sequence project.sources[${String(index)}]`) !== 'video') continue;
		if (dataProperty(source, 'proxyAttachment', `Framescaper sequence project.sources[${String(index)}]`) !== null) {
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
