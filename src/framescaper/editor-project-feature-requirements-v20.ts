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
import { normalizeVideoKeyframeCurves } from '../common/editor/video-keyframe-curves.ts';
import {
	FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v20.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from './editor-project-feature-requirements-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import { admitFramescaperProjectV20Structure } from './editor-project-v20-structural-admission.ts';

export const FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20 = Object.freeze({
	id: 'framescaper.video-keyframes',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes,
	displayName: 'Video keyframes',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export interface FramescaperProjectFeatureCompatibilityServiceV20 {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null;
}

/** Reconcile immutable V19 ownership first, then the V20 keyframe declaration. */
export function reconcileFramescaperProjectFeatureRequirementsV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV20Profile(profile);
	admitFramescaperProjectV20Structure(project);
	const candidate = dataRecord(project, 'Framescaper V20 project');
	const manifest = normalizeManifest(candidate);
	assertNoKeyframeRequirementConflict(manifest);
	const v19Manifest = reconcileFramescaperProjectFeatureRequirementsV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		projectForV19RequirementOwnership(candidate, manifest),
	);
	if (!projectHasAuthoredKeyframes(candidate)) return v19Manifest;
	if (v19Manifest.requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Framescaper V20 owned requirements exceed the manifest limit.');
	}
	return Object.freeze({
		schemaVersion: v19Manifest.schemaVersion,
		requirements: Object.freeze([
			...v19Manifest.requirements,
			FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
		]),
	});
}

/** Validate exact V20 ownership after the transient V19 view has passed. */
export function validateFramescaperProjectFeatureRequirementsV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV20Profile(profile);
	admitFramescaperProjectV20Structure(project);
	const candidate = dataRecord(project, 'Framescaper V20 project');
	const manifest = normalizeManifest(candidate);
	const index = assertNoKeyframeRequirementConflict(manifest);
	const present = projectHasAuthoredKeyframes(candidate);
	if (present && index < 0) {
		throw new TypeError('Authored Framescaper V20 curves require framescaper.video-keyframes.');
	}
	if (!present && index >= 0) {
		throw new TypeError('A neutral Framescaper V20 project must not retain framescaper.video-keyframes.');
	}
	return manifest;
}

/** Remove only V20 ownership for an exact transient V19 validation view. */
export function framescaperProjectFeatureRequirementsForV19FoundationV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectV20Profile(profile);
	admitFramescaperProjectV20Structure(project);
	const manifest = normalizeManifest(dataRecord(project, 'Framescaper V20 project'));
	assertNoKeyframeRequirementConflict(manifest);
	return manifestWithoutKeyframes(manifest);
}

export function createFramescaperProjectFeatureCompatibilityServiceV20(
	profile: FramescaperProjectV20Profile | unknown,
): FramescaperProjectFeatureCompatibilityServiceV20 {
	assertFramescaperProjectV20Profile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const knownFeatureIds = new Set(capability.registrations.map(({ featureId }) => featureId));
	const availableFeatureIds = new Set(capability.registrations
		.filter(({ available }) => available)
		.map(({ featureId }) => featureId));
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (project === null || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as Record<string, unknown>;
		if (optionalDataProperty(candidate, 'schemaVersion', 'Framescaper project') !== 20) return null;
		admitFramescaperProjectV20Structure(candidate);
		const manifest = validateFramescaperProjectFeatureRequirementsV20(profile, candidate);
		return evaluateProjectFeatureRequirements(manifest, {
			knownFeatureIds,
			availableFeatureIds,
			sources: dataArray(candidate, 'sources', 'Framescaper project'),
			clips: dataArray(candidate, 'clips', 'Framescaper project'),
			tracks: dataArray(candidate, 'tracks', 'Framescaper project'),
			schemaVersion: 20,
			sampleRate: dataProperty(candidate, 'sampleRate', 'Framescaper project'),
			sequences: dataArray(candidate, 'sequences', 'Framescaper project'),
			primarySequenceId: dataProperty(candidate, 'primarySequenceId', 'Framescaper project'),
		});
	}
}

function projectForV19RequirementOwnership(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	return {
		...copyDataRecord(project, 'Framescaper V20 project'),
		schemaVersion: 19,
		featureRequirements: manifestWithoutKeyframes(manifest),
	};
}

function manifestWithoutKeyframes(
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			(requirement) => requirement.id !== FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20.id,
		)),
	});
}

function projectHasAuthoredKeyframes(project: Record<string, unknown>): boolean {
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper V20 project'), 'projectBin');
	const clips = [
		...dataArray(project, 'clips', 'Framescaper V20 project'),
		...dataArray(projectBin, 'clips', 'Framescaper V20 project.projectBin'),
	];
	for (const [index, clip] of clips.entries()) {
		if (dataProperty(clip, 'kind', `Framescaper V20 clip ${String(index)}`) !== 'video') continue;
		const name = `Framescaper V20 video clip ${String(dataProperty(clip, 'id', 'video clip'))}`;
		const normalized = normalizeVideoKeyframeCurves(
			dataProperty(clip, 'videoKeyframes', name),
			{
				duration: { num: dataProperty(clip, 'sequenceFrameCount', name), den: 1 },
				composition: dataProperty(clip, 'videoComposition', name),
				videoEffects: dataProperty(clip, 'videoEffects', name),
			},
			`${name}.videoKeyframes`,
		);
		if (normalized.curves.length > 0) return true;
	}
	return false;
}

function assertNoKeyframeRequirementConflict(manifest: ProjectFeatureRequirementsManifest): number {
	const expected = FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20;
	const index = manifest.requirements.findIndex(({ id }) => id === expected.id);
	const found = manifest.requirements[index];
	if (found && (
		found.featureId !== expected.featureId
		|| found.displayName !== expected.displayName
		|| found.disposition !== expected.disposition
		|| found.fallback !== null
	)) {
		throw new TypeError('The reserved Framescaper video-keyframes requirement conflicts with publisher data.');
	}
	if (manifest.requirements.some((requirement) => (
		requirement.id !== expected.id && requirement.featureId === expected.featureId
	))) {
		throw new TypeError('A publisher video-keyframes substitution cannot replace Framescaper ownership.');
	}
	return index;
}

function normalizeManifest(project: Record<string, unknown>): ProjectFeatureRequirementsManifest {
	return normalizeProjectFeatureRequirements(dataProperty(
		project, 'featureRequirements', 'Framescaper V20 project',
	), {
		sources: dataArray(project, 'sources', 'Framescaper V20 project'),
		clips: dataArray(project, 'clips', 'Framescaper V20 project'),
		tracks: dataArray(project, 'tracks', 'Framescaper V20 project'),
		schemaVersion: dataProperty(project, 'schemaVersion', 'Framescaper V20 project'),
		sampleRate: dataProperty(project, 'sampleRate', 'Framescaper V20 project'),
		sequences: dataArray(project, 'sequences', 'Framescaper V20 project'),
		primarySequenceId: dataProperty(project, 'primarySequenceId', 'Framescaper V20 project'),
	});
}

function copyDataRecord(value: Record<string, unknown>, name: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol properties.`);
		Object.defineProperty(result, key, {
			configurable: true, enumerable: true, value: dataProperty(value, key, name), writable: true,
		});
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
