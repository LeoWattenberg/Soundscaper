/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	normalizeFramescaperProfessionalVideoSourceProfessionalMedia,
	type FramescaperProfessionalVideoSourceProfessionalMedia,
} from './editor-project-professional-media-validation.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsNativeMedia,
	validateFramescaperProjectFeatureRequirementsNativeMedia,
} from './editor-project-feature-requirements-native-media.ts';
import { assertFramescaperProjectNativeMediaProfile } from './editor-domain-runtime-profile.ts';
import { validateFramescaperProjectFinishing, type FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { validateFramescaperOpenFxOwnershipNativeMedia } from './editor-project-native-media-openfx-validation.ts';

export const FRAMESCAPER_PROJECT_NATIVE_MEDIA_SCHEMA_VERSION = 1 as const;

export interface FramescaperProjectNativeMedia extends Omit<FramescaperProjectFinishing,
	'schemaVersion' | 'sources' | 'featureRequirements'> {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly (FramescaperProfessionalVideoSourceProfessionalMedia | Readonly<Record<string, unknown>>)[];
	readonly ofxEffects: readonly OfxEffectStateV26[];
	/*
	 * FramescaperProjectSequence deliberately owns an index signature. Applying a
	 * second Omit to that lineage widens inherited named members back to
	 * unknown, so restate the finishing finishing authority that V14 consumes.
	 */
	readonly videoColorContexts: FramescaperProjectFinishing['videoColorContexts'];
	readonly videoSourceColorInterpretations: FramescaperProjectFinishing['videoSourceColorInterpretations'];
	readonly videoVisualPresentations: FramescaperProjectFinishing['videoVisualPresentations'];
	readonly videoProcessorStacks: FramescaperProjectFinishing['videoProcessorStacks'];
	readonly videoMotionAnalyses: FramescaperProjectFinishing['videoMotionAnalyses'];
	readonly videoFinishingPresets: FramescaperProjectFinishing['videoFinishingPresets'];
	readonly videoCaptionTracks: FramescaperProjectFinishing['videoCaptionTracks'];
	readonly automationLanes: FramescaperProjectFinishing['automationLanes'];
	readonly mixer: FramescaperProjectFinishing['mixer'];
}

export const FRAMESCAPER_NATIVE_MEDIA_PROJECT_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt', 'sampleRate',
	'masterChannels', 'tempo', 'snap', 'timeDisplay', 'metadata', 'selection', 'loop',
	'view', 'sources', 'clips', 'tracks', 'master', 'mixer', 'opaqueExtensions',
	'projectBin', 'featureRequirements', 'sequences', 'primarySequenceId', 'tempoMap',
	'signatureMap', 'timelineAnnotations', 'trackFolders', 'takeGroups', 'subsequences',
	'multicameraGroups', 'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
	'videoFreezeFallbacks', 'videoColorContexts', 'videoSourceColorInterpretations',
	'videoVisualPresentations', 'videoProcessorStacks', 'videoMotionAnalyses',
	'videoFinishingPresets', 'videoCaptionTracks', 'automationLanes', 'ofxEffects',
]);

export function validateFramescaperProjectNativeMedia(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	const candidate = exactProject(project);
	if (candidate.schemaVersion !== FRAMESCAPER_PROJECT_NATIVE_MEDIA_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(candidate.schemaVersion)}.`);
	}
	validateFramescaperProjectFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(candidate),
	);
	validateProfessionalSources(candidate);
	validateFramescaperOpenFxOwnershipNativeMedia(candidate);
	validateFramescaperProjectFeatureRequirementsNativeMedia(profile, candidate);
	return true;
}

export function normalizeFramescaperProjectNativeStateNativeMedia(
	profile: unknown,
	project: Record<string, unknown>,
): void {
	assertFramescaperProjectNativeMediaProfile(profile);
	project.sources = records(project.sources, 'sources').map((source) => {
		if (source.kind !== 'video') {
			if (Object.hasOwn(source, 'imageSequence')) delete source.imageSequence;
			return source;
		}
		return structuredClone(normalizeFramescaperProfessionalVideoSourceProfessionalMedia(source));
	});
	if (!Array.isArray(project.ofxEffects)) project.ofxEffects = [];
	project.ofxEffects = structuredClone(project.ofxEffects);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsNativeMedia(profile, project);
}

function validateProfessionalSources(project: Record<string, unknown>): void {
	for (const source of records(project.sources, 'sources')) {
		if (source.kind === 'video') {
			const normalized = normalizeFramescaperProfessionalVideoSourceProfessionalMedia(source);
			if (JSON.stringify(source) !== JSON.stringify(normalized)) {
				throw new TypeError(`Framescaper nativeMedia professional source ${String(source.id)} is not canonical.`);
			}
		} else if (Object.hasOwn(source, 'imageSequence')) {
			throw new TypeError('Only a Framescaper nativeMedia video source may own image-sequence authority.');
		}
	}
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper nativeMedia project');
	const expected = new Set(FRAMESCAPER_NATIVE_MEDIA_PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		const unexpected = keys.find((key) => typeof key !== 'string' || !expected.has(key));
		throw new TypeError(`Framescaper nativeMedia project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of FRAMESCAPER_NATIVE_MEDIA_PROJECT_FIELDS) {
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
