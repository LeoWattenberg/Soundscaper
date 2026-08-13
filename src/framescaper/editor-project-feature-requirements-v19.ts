/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
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
import {
	isDefaultVideoClipComposition,
	normalizeVideoClipComposition,
} from '../common/editor/video-clip-composition.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV18,
} from './editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';

export const FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19 = Object.freeze({
	id: 'framescaper.video-geometry',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoGeometry,
	displayName: 'Video transforms and compositing',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export interface FramescaperProjectFeatureCompatibilityServiceV19 {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null;
}

/** Reconcile V18-owned declarations first, then the V19 geometry declaration. */
export function reconcileFramescaperProjectFeatureRequirementsV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV19Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V19 project');
	const manifest = normalizeManifest(candidate);
	assertNoCompositionRequirementConflict(manifest);
	const foundation = projectForV18RequirementOwnership(candidate, manifest);
	const v18Manifest = reconcileFramescaperProjectFeatureRequirementsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	if (!projectHasAuthoredComposition(candidate)) return v18Manifest;
	if (v18Manifest.requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Framescaper V19 owned requirements exceed the manifest limit.');
	}
	return Object.freeze({
		schemaVersion: v18Manifest.schemaVersion,
		requirements: Object.freeze([
			...v18Manifest.requirements,
			FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19,
		]),
	});
}

/** Validate exact V19 ownership after the V18 validation view has passed. */
export function validateFramescaperProjectFeatureRequirementsV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV19Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V19 project');
	const manifest = normalizeManifest(candidate);
	const index = assertNoCompositionRequirementConflict(manifest);
	const present = projectHasAuthoredComposition(candidate);
	if (present && index < 0) {
		throw new TypeError(
			'An authored Framescaper V19 composition requires framescaper.video-geometry.',
		);
	}
	if (!present && index >= 0) {
		throw new TypeError(
			'A neutral Framescaper V19 project must not retain framescaper.video-geometry.',
		);
	}
	return manifest;
}

/** Remove only the V19 declaration for an exact transient V18 validation view. */
export function framescaperProjectFeatureRequirementsForV18FoundationV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV19Profile(profile);
	const manifest = normalizeManifest(dataRecord(project, 'Framescaper V19 project'));
	assertNoCompositionRequirementConflict(manifest);
	return manifestWithoutComposition(manifest);
}

export function createFramescaperProjectFeatureCompatibilityServiceV19(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperProjectFeatureCompatibilityServiceV19 {
	assertFramescaperProjectV19Profile(profile);
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
		if (optionalDataProperty(candidate, 'schemaVersion', 'Framescaper project') !== 19) return null;
		const manifest = validateFramescaperProjectFeatureRequirementsV19(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: dataArray(candidate, 'sources', 'Framescaper project'),
			clips: dataArray(candidate, 'clips', 'Framescaper project'),
			tracks: dataArray(candidate, 'tracks', 'Framescaper project'),
			schemaVersion: 19,
			sampleRate: dataProperty(candidate, 'sampleRate', 'Framescaper project'),
			sequences: dataArray(candidate, 'sequences', 'Framescaper project'),
			primarySequenceId: dataProperty(candidate, 'primarySequenceId', 'Framescaper project'),
		});
	}
}

function projectForV18RequirementOwnership(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	return {
		...copyDataRecord(project, 'Framescaper V19 project'),
		schemaVersion: 18,
		featureRequirements: manifestWithoutComposition(manifest),
	};
}

function manifestWithoutComposition(
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			(requirement) => requirement.id !== FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19.id,
		)),
	});
}

function projectHasAuthoredComposition(project: Record<string, unknown>): boolean {
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper V19 project'), 'projectBin');
	const clips = [
		...dataArray(project, 'clips', 'Framescaper V19 project'),
		...dataArray(projectBin, 'clips', 'Framescaper V19 project.projectBin'),
	];
	for (const [index, clip] of clips.entries()) {
		if (dataProperty(clip, 'kind', `Framescaper V19 clip ${String(index)}`) !== 'video') continue;
		const composition = dataProperty(
			clip,
			'videoComposition',
			`Framescaper V19 video clip ${String(clip.id)}`,
		);
		if (!isDefaultVideoClipComposition(normalizeVideoClipComposition(composition))) return true;
	}
	return false;
}

function assertNoCompositionRequirementConflict(manifest: ProjectFeatureRequirementsManifest): number {
	const expected = FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19;
	const index = manifest.requirements.findIndex(({ id }) => id === expected.id);
	const found = manifest.requirements[index];
	if (found && (
		found.featureId !== expected.featureId
		|| found.displayName !== expected.displayName
		|| found.disposition !== expected.disposition
		|| found.fallback !== null
	)) {
		throw new TypeError('The reserved Framescaper video-composition requirement conflicts with publisher data.');
	}
	if (manifest.requirements.some((requirement) => (
		requirement.id !== expected.id && requirement.featureId === expected.featureId
	))) {
		throw new TypeError('A publisher video-composition substitution cannot replace Framescaper ownership.');
	}
	return index;
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(dataProperty(project, 'featureRequirements', 'Framescaper V19 project'), {
		sources: dataArray(project, 'sources', 'Framescaper V19 project'),
		clips: dataArray(project, 'clips', 'Framescaper V19 project'),
		tracks: dataArray(project, 'tracks', 'Framescaper V19 project'),
		schemaVersion: dataProperty(project, 'schemaVersion', 'Framescaper V19 project'),
		sampleRate: dataProperty(project, 'sampleRate', 'Framescaper V19 project'),
		sequences: dataArray(project, 'sequences', 'Framescaper V19 project'),
		primarySequenceId: dataProperty(project, 'primarySequenceId', 'Framescaper V19 project'),
	});
}

function copyDataRecord(value: Record<string, unknown>, name: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol properties.`);
		result[key] = dataProperty(value, key, name);
	}
	return result;
}

function dataArray(value: Record<string, unknown>, key: string, name: string): Record<string, unknown>[] {
	const candidate = dataProperty(value, key, name);
	if (!Array.isArray(candidate)) throw new TypeError(`${name}.${key} must be an array.`);
	return candidate.map((item, index) => dataRecord(item, `${name}.${key}[${String(index)}]`));
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
