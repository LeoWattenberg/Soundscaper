/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
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
	FRAMESCAPER_RETIME_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-retime.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsComposition,
} from './editor-project-feature-requirements-composition.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import { admitFramescaperProjectRetimeStructure } from './editor-project-retime-structural-admission.ts';

export const FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_RETIME = Object.freeze({
	id: 'framescaper.video-keyframes',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes,
	displayName: 'Video keyframes',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export interface FramescaperProjectFeatureCompatibilityServiceRetime {
	readonly evaluate: (project: unknown) => ProjectFeatureRequirementsReport | null;
}

/** Reconcile immutable composition ownership first, then the retime keyframe declaration. */
export function reconcileFramescaperProjectFeatureRequirementsRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectRetimeProfile(profile);
	admitFramescaperProjectRetimeStructure(project);
	const candidate = dataRecord(project, 'Framescaper retime project');
	const manifest = reconcileProjectOwnedFeatureRequirements(candidate, normalizeManifest(candidate));
	assertNoKeyframeRequirementConflict(manifest);
	const v19Manifest = reconcileFramescaperProjectFeatureRequirementsComposition(
		FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
		projectForCompositionRequirementOwnership(candidate, manifest),
	);
	if (!projectHasAuthoredKeyframes(candidate)) return v19Manifest;
	if (v19Manifest.requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Framescaper retime owned requirements exceed the manifest limit.');
	}
	return Object.freeze({
		schemaVersion: v19Manifest.schemaVersion,
		requirements: Object.freeze([
			...v19Manifest.requirements,
			FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_RETIME,
		]),
	});
}

/** Validate exact retime ownership after the transient composition view has passed. */
export function validateFramescaperProjectFeatureRequirementsRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectRetimeProfile(profile);
	admitFramescaperProjectRetimeStructure(project);
	const candidate = dataRecord(project, 'Framescaper retime project');
	const manifest = normalizeManifest(candidate);
	const index = assertNoKeyframeRequirementConflict(manifest);
	const present = projectHasAuthoredKeyframes(candidate);
	if (present && index < 0) {
		throw new TypeError('Authored Framescaper retime curves require framescaper.video-keyframes.');
	}
	if (!present && index >= 0) {
		throw new TypeError('A neutral Framescaper retime project must not retain framescaper.video-keyframes.');
	}
	return manifest;
}

/** Remove only retime ownership for an exact transient composition validation view. */
export function framescaperProjectFeatureRequirementsForCompositionFoundationRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: unknown,
): ProjectFeatureRequirementsManifest {
	assertFramescaperProjectRetimeProfile(profile);
	admitFramescaperProjectRetimeStructure(project);
	const manifest = normalizeManifest(dataRecord(project, 'Framescaper retime project'));
	assertNoKeyframeRequirementConflict(manifest);
	return manifestWithoutKeyframes(manifest);
}

export function createFramescaperProjectFeatureCompatibilityServiceRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
): FramescaperProjectFeatureCompatibilityServiceRetime {
	assertFramescaperProjectRetimeProfile(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_RETIME_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
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
		admitFramescaperProjectRetimeStructure(candidate);
		const manifest = validateFramescaperProjectFeatureRequirementsRetime(profile, candidate);
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

function projectForCompositionRequirementOwnership(
	project: Record<string, unknown>,
	manifest: ProjectFeatureRequirementsManifest,
): Record<string, unknown> {
	return {
		...copyDataRecord(project, 'Framescaper retime project'),
		schemaVersion:  1,
		featureRequirements: manifestWithoutKeyframes(manifest),
	};
}

function manifestWithoutKeyframes(
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(manifest.requirements.filter(
			(requirement) => requirement.id !== FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_RETIME.id,
		)),
	});
}

function projectHasAuthoredKeyframes(project: Record<string, unknown>): boolean {
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper retime project'), 'projectBin');
	const clips = [
		...dataArray(project, 'clips', 'Framescaper retime project'),
		...dataArray(projectBin, 'clips', 'Framescaper retime project.projectBin'),
	];
	for (const [index, clip] of clips.entries()) {
		if (dataProperty(clip, 'kind', `Framescaper retime clip ${String(index)}`) !== 'video') continue;
		const name = `Framescaper retime video clip ${String(dataProperty(clip, 'id', 'video clip'))}`;
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
	const expected = FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_RETIME;
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
		project, 'featureRequirements', 'Framescaper retime project',
	), {
		sources: dataArray(project, 'sources', 'Framescaper retime project'),
		clips: dataArray(project, 'clips', 'Framescaper retime project'),
		tracks: dataArray(project, 'tracks', 'Framescaper retime project'),
		schemaVersion: dataProperty(project, 'schemaVersion', 'Framescaper retime project'),
		sampleRate: dataProperty(project, 'sampleRate', 'Framescaper retime project'),
		sequences: dataArray(project, 'sequences', 'Framescaper retime project'),
		primarySequenceId: dataProperty(project, 'primarySequenceId', 'Framescaper retime project'),
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
