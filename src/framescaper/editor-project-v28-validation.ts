/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	normalizeFramescaperProfessionalVideoSourceV25,
	type FramescaperProfessionalVideoSourceV25,
} from './editor-project-v25-validation.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV28,
	validateFramescaperProjectFeatureRequirementsV28,
} from './editor-project-feature-requirements-v28.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { validateFramescaperProjectV27, type FramescaperProjectV27 } from './editor-project-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { validateFramescaperOpenFxOwnershipV28 } from './editor-project-v28-openfx-validation.ts';

export const FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION = 28 as const;

export interface FramescaperProjectV28 extends Omit<FramescaperProjectV27,
	'schemaVersion' | 'sources' | 'featureRequirements'> {
	readonly schemaVersion: 28;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly (FramescaperProfessionalVideoSourceV25 | Readonly<Record<string, unknown>>)[];
	readonly ofxEffects: readonly OfxEffectStateV26[];
	/*
	 * FramescaperProjectV18 deliberately owns an index signature. Applying a
	 * second Omit to that lineage widens inherited named members back to
	 * unknown, so restate the V27 finishing authority that V14 consumes.
	 */
	readonly videoColorContexts: FramescaperProjectV27['videoColorContexts'];
	readonly videoSourceColorInterpretations: FramescaperProjectV27['videoSourceColorInterpretations'];
	readonly videoVisualPresentations: FramescaperProjectV27['videoVisualPresentations'];
	readonly videoProcessorStacks: FramescaperProjectV27['videoProcessorStacks'];
	readonly videoMotionAnalyses: FramescaperProjectV27['videoMotionAnalyses'];
	readonly videoFinishingPresets: FramescaperProjectV27['videoFinishingPresets'];
	readonly videoCaptionTracks: FramescaperProjectV27['videoCaptionTracks'];
	readonly automationLanes: FramescaperProjectV27['automationLanes'];
	readonly mixer: FramescaperProjectV27['mixer'];
}

export const FRAMESCAPER_V28_PROJECT_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt', 'sampleRate',
	'masterChannels', 'tempo', 'snap', 'timeDisplay', 'metadata', 'selection', 'loop',
	'view', 'sources', 'clips', 'tracks', 'master', 'mixer', 'opaqueExtensions',
	'projectBin', 'featureRequirements', 'sequences', 'primarySequenceId', 'tempoMap',
	'signatureMap', 'timelineAnnotations', 'trackFolders', 'takeGroups', 'subsequences',
	'multicameraGroups', 'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
	'videoFreezeFallbacks', 'videoColorContexts', 'videoSourceColorInterpretations',
	'videoVisualPresentations', 'videoProcessorStacks', 'videoMotionAnalyses',
	'videoFinishingPresets', 'videoCaptionTracks', 'automationLanes', 'ofxEffects',
]);

export function validateFramescaperProjectV28(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	const candidate = exactProject(project);
	if (candidate.schemaVersion !== FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(candidate.schemaVersion)}.`);
	}
	validateFramescaperProjectV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV27FoundationShapeV28(candidate),
	);
	validateProfessionalSources(candidate);
	validateFramescaperOpenFxOwnershipV28(candidate);
	validateFramescaperProjectFeatureRequirementsV28(profile, candidate);
	return true;
}

export function normalizeFramescaperProjectNativeStateV28(
	profile: unknown,
	project: Record<string, unknown>,
): void {
	assertFramescaperProjectV28Profile(profile);
	project.sources = records(project.sources, 'sources').map((source) => {
		if (source.kind !== 'video') {
			if (Object.hasOwn(source, 'imageSequence')) delete source.imageSequence;
			return source;
		}
		return structuredClone(normalizeFramescaperProfessionalVideoSourceV25(source));
	});
	if (!Array.isArray(project.ofxEffects)) project.ofxEffects = [];
	project.ofxEffects = structuredClone(project.ofxEffects);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV28(profile, project);
}

function validateProfessionalSources(project: Record<string, unknown>): void {
	for (const source of records(project.sources, 'sources')) {
		if (source.kind === 'video') {
			const normalized = normalizeFramescaperProfessionalVideoSourceV25(source);
			if (JSON.stringify(source) !== JSON.stringify(normalized)) {
				throw new TypeError(`Framescaper V28 professional source ${String(source.id)} is not canonical.`);
			}
		} else if (Object.hasOwn(source, 'imageSequence')) {
			throw new TypeError('Only a Framescaper V28 video source may own image-sequence authority.');
		}
	}
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper V28 project');
	const expected = new Set(FRAMESCAPER_V28_PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		const unexpected = keys.find((key) => typeof key !== 'string' || !expected.has(key));
		throw new TypeError(`Framescaper V28 project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of FRAMESCAPER_V28_PROJECT_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(project, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${field} must be data.`);
	}
	return project;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
