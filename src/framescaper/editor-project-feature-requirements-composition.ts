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
	reconcileFramescaperProjectFeatureRequirementsSequence,
} from './editor-project-feature-requirements-sequence.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectCompositionProfile } from './editor-domain-runtime-profile.ts';

export const FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_COMPOSITION = Object.freeze({
	id: 'framescaper.video-geometry',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoGeometry,
	displayName: 'Video transforms and compositing',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export interface FramescaperProjectFeatureCompatibilityServiceComposition {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null;
}

/** Reconcile sequence-owned declarations first, then the composition geometry declaration. */
export function reconcileFramescaperProjectFeatureRequirementsComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectCompositionProfile(profile);
	const candidate = dataRecord(project, 'Framescaper composition project');
	const manifest = normalizeManifest(candidate);
	assertNoCompositionRequirementConflict(manifest);
	const foundation = projectForSequenceRequirementOwnership(candidate, manifest);
	const v18Manifest = reconcileFramescaperProjectFeatureRequirementsSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	if (!projectHasAuthoredComposition(candidate)) return v18Manifest;
	if (v18Manifest.requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Framescaper composition owned requirements exceed the manifest limit.');
	}
	return Object.freeze({
		schemaVersion: v18Manifest.schemaVersion,
		requirements: Object.freeze([
			...v18Manifest.requirements,
			FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_COMPOSITION,
		]),
	});
}

/** Validate exact composition ownership after the sequence validation view has passed. */
export function validateFramescaperProjectFeatureRequirementsComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectCompositionProfile(profile);
	const candidate = dataRecord(project, 'Framescaper composition project');
	const manifest = normalizeManifest(candidate);
	const index = assertNoCompositionRequirementConflict(manifest);
	const present = projectHasAuthoredComposition(candidate);
	if (present && index < 0) {
		throw new TypeError(
			'An authored Framescaper composition composition requires framescaper.video-geometry.',
		);
	}
	if (!present && index >= 0) {
		throw new TypeError(
			'A neutral Framescaper composition project must not retain framescaper.video-geometry.',
		);
	}
	return manifest;
}

/** Remove only the composition declaration for an exact transient sequence validation view. */
export function framescaperProjectFeatureRequirementsForSequenceFoundationComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectCompositionProfile(profile);
	const manifest = normalizeManifest(dataRecord(project, 'Framescaper composition project'));
	assertNoCompositionRequirementConflict(manifest);
	return manifestWithoutComposition(manifest);
}

export function createFramescaperProjectFeatureCompatibilityServiceComposition(
	profile: EditorProjectRuntimeProfile | unknown,
): FramescaperProjectFeatureCompatibilityServiceComposition {
	assertFramescaperProjectCompositionProfile(profile);
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
		const manifest = validateFramescaperProjectFeatureRequirementsComposition(profile, candidate);
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

function projectForSequenceRequirementOwnership(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	return {
		...copyDataRecord(project, 'Framescaper composition project'),
		schemaVersion:  1,
		featureRequirements: manifestWithoutComposition(manifest),
	};
}

function manifestWithoutComposition(
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			(requirement) => requirement.id !== FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_COMPOSITION.id,
		)),
	});
}

function projectHasAuthoredComposition(project: Record<string, unknown>): boolean {
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper composition project'), 'projectBin');
	const clips = [
		...dataArray(project, 'clips', 'Framescaper composition project'),
		...dataArray(projectBin, 'clips', 'Framescaper composition project.projectBin'),
	];
	for (const [index, clip] of clips.entries()) {
		if (dataProperty(clip, 'kind', `Framescaper composition clip ${String(index)}`) !== 'video') continue;
		const composition = dataProperty(
			clip,
			'videoComposition',
			`Framescaper composition video clip ${String(clip.id)}`,
		);
		if (!isDefaultVideoClipComposition(normalizeVideoClipComposition(composition))) return true;
	}
	return false;
}

function assertNoCompositionRequirementConflict(manifest: ProjectFeatureRequirementsManifest): number {
	const expected = FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_COMPOSITION;
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
	return normalizeProjectFeatureRequirements(dataProperty(project, 'featureRequirements', 'Framescaper composition project'), {
		sources: dataArray(project, 'sources', 'Framescaper composition project'),
		clips: dataArray(project, 'clips', 'Framescaper composition project'),
		tracks: dataArray(project, 'tracks', 'Framescaper composition project'),
		schemaVersion: dataProperty(project, 'schemaVersion', 'Framescaper composition project'),
		sampleRate: dataProperty(project, 'sampleRate', 'Framescaper composition project'),
		sequences: dataArray(project, 'sequences', 'Framescaper composition project'),
		primarySequenceId: dataProperty(project, 'primarySequenceId', 'Framescaper composition project'),
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
