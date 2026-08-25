/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	validateFramescaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import { validateFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';

export const FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION = 30 as const;

export interface FramescaperProjectV30 extends Omit<FramescaperProjectV28,
	'schemaVersion' | 'featureRequirements'> {
	readonly schemaVersion: 30;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
}

const PROJECT_FIELDS = Object.freeze([
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

export function validateFramescaperProjectV30(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	const candidate = exactProject(project);
	if (candidate.schemaVersion !== FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(candidate.schemaVersion)}.`);
	}
	assertNoUnvalidatedImageState(candidate);
	validateFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV30(candidate),
	);
	validateFramescaperProjectFeatureRequirementsV30(profile, candidate);
	return true;
}

function assertNoUnvalidatedImageState(project: Record<string, unknown>): void {
	const bin = record(project.projectBin, 'projectBin');
	for (const item of [
		...records(project.sources, 'sources'),
		...records(project.clips, 'clips'),
		...records(bin.clips, 'projectBin.clips'),
	]) {
		if (item.kind === 'image') throw new TypeError('Framescaper V30 image state requires the canonical image model.');
	}
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper V30 project');
	const expected = new Set(PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		const unexpected = keys.find((key) => typeof key !== 'string' || !expected.has(key));
		throw new TypeError(`Framescaper V30 project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of PROJECT_FIELDS) {
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
