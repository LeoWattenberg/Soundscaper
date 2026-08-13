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

/** Reconcile the private declaration from exact V18 attachment state. */
export function reconcileFramescaperProjectFeatureRequirementsV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV18Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V18 project');
	const manifest = normalizeManifest(candidate);
	const attached = projectHasProxyAttachment(candidate);
	const ownedIndex = assertNoProxyRequirementConflict(manifest);
	if (attached && ownedIndex >= 0) return manifest;
	if (!attached && ownedIndex < 0) return manifest;

	const requirements = manifest.requirements.filter(
		(requirement) => requirement.id !== FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.id,
	);
	if (attached) {
		if (requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
			throw new RangeError('Framescaper V18 proxy requirements exceed the manifest limit.');
		}
		requirements.push(FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18);
	}
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

/** Validate that persisted V18 feature ownership already matches attachment state. */
export function validateFramescaperProjectFeatureRequirementsV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV18Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V18 project');
	const manifest = normalizeManifest(candidate);
	const attached = projectHasProxyAttachment(candidate);
	const ownedIndex = assertNoProxyRequirementConflict(manifest);
	if (attached && ownedIndex < 0) {
		throw new TypeError('An attached Framescaper V18 project requires framescaper.video-proxy.');
	}
	if (!attached && ownedIndex >= 0) {
		throw new TypeError('An all-null Framescaper V18 project must not retain framescaper.video-proxy.');
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
			(requirement) => requirement.id !== FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.id,
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

function assertNoProxyRequirementConflict(manifest: ProjectFeatureRequirementsManifest): number {
	const ownedIndex = manifest.requirements.findIndex(
		(requirement) => requirement.id === FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.id,
	);
	if (ownedIndex >= 0 && !ownedRequirementMatches(manifest.requirements[ownedIndex])) {
		throw new TypeError('The reserved Framescaper video-proxy requirement conflicts with publisher data.');
	}
	if (manifest.requirements.some((requirement) => (
		requirement.id !== FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.id
		&& requirement.featureId === FRAMESCAPER_VIDEO_PROXY_FEATURE_ID
	))) {
		throw new TypeError('A publisher video-proxy substitution cannot replace Framescaper ownership.');
	}
	return ownedIndex;
}

function ownedRequirementMatches(requirement: ProjectFeatureRequirement | undefined): boolean {
	return Boolean(
		requirement
		&& requirement.featureId === FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.featureId
		&& requirement.displayName === FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.displayName
		&& requirement.disposition === FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18.disposition
		&& requirement.fallback === null,
	);
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
