/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v32.ts';
import {
	validateFramescaperProjectFeatureRequirementsV32,
} from './editor-project-feature-requirements-v32.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import { validateFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV28FoundationShapeV32 } from './editor-project-v32-foundation.ts';

export const FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION = 32 as const;

export type FramescaperImageOrInheritedClipV32 =
	| Readonly<Record<string, unknown>>
	| FramescaperImageClipV1;

export interface FramescaperProjectV32 extends Omit<FramescaperProjectV28,
	'schemaVersion' | 'featureRequirements' | 'sources' | 'clips'> {
	readonly schemaVersion: 32;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly sampleRate: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly (FramescaperProjectV28['sources'][number] | FramescaperImageSourceV1)[];
	readonly clips: readonly FramescaperImageOrInheritedClipV32[];
	readonly tracks: readonly (Readonly<Record<string, unknown>> & Readonly<{
		id: string;
		type: string;
		locked: boolean;
		clipIds: readonly string[];
	}>)[];
	readonly projectBin: Readonly<Record<string, unknown>> & Readonly<{
		clips: readonly FramescaperImageOrInheritedClipV32[];
	}>;
	readonly selection: Readonly<Record<string, unknown>> & Readonly<{ clipIds: readonly string[] }>;
	readonly sequences: readonly (Readonly<Record<string, unknown>> & Readonly<{
		id: string;
		rate: Readonly<{ num: number; den: number }>;
		trackIds: readonly string[];
	}>)[];
	readonly primarySequenceId: string;
}

export const FRAMESCAPER_V32_PROJECT_FIELDS = Object.freeze([
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

export function validateFramescaperProjectV32(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	const candidate = exactProject(project);
	if (candidate.schemaVersion !== FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(candidate.schemaVersion)}.`);
	}
	validateFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV32(candidate),
	);
	validateImageModels(candidate);
	validateFramescaperProjectFeatureRequirementsV32(profile, candidate);
	return true;
}

function validateImageModels(project: Record<string, unknown>): void {
	const sources = records(project.sources, 'sources');
	const timelineClips = records(project.clips, 'clips');
	const bin = record(project.projectBin, 'projectBin');
	const binClips = records(bin.clips, 'projectBin.clips');
	const tracks = records(project.tracks, 'tracks');
	const sequences = records(project.sequences, 'sequences');
	const sourceById = new Map(sources.map((source) => [String(source.id), source]));
	const sequenceIds = new Set(sequences.map(({ id }) => String(id)));
	const identities = new Set<string>();
	for (const owner of [...sources, ...timelineClips, ...binClips, ...tracks, ...sequences]) {
		const id = String(owner.id);
		if (identities.has(id)) throw new RangeError(`V32 image identity ${id} is duplicated.`);
		identities.add(id);
	}
	for (const source of sources) {
		if (source.kind !== 'image') continue;
		assertCanonical(source, normalizeFramescaperImageSourceV1(source), 'image source');
	}
	const timelineImageIds = new Set<string>();
	const binImageIds = new Set<string>();
	for (const [scope, clips] of [['timeline', timelineClips], ['project-bin', binClips]] as const) {
		for (const clip of clips) {
			if (clip.kind !== 'image') continue;
			const normalized = normalizeFramescaperImageClipV1(clip);
			assertCanonical(clip, normalized, 'image clip');
			const source = sourceById.get(normalized.sourceId);
			if (!source || source.kind !== 'image') {
				throw new ReferenceError(`Image clip references missing matching source ${normalized.sourceId}.`);
			}
			if (!sequenceIds.has(normalized.sequenceId)) {
				throw new ReferenceError(`Image clip sequence ${normalized.sequenceId} is missing.`);
			}
			if (BigInt(normalized.sourceStartTicks) >= BigInt(String(
				record(source.canonical, 'image canonical summary').durationTicks,
			))) throw new RangeError('Image clip source start must precede its source duration.');
			(scope === 'timeline' ? timelineImageIds : binImageIds).add(normalized.id);
		}
	}
	for (const clipId of timelineImageIds) {
		const owners = tracks.filter((track) => Array.isArray(track.clipIds) && track.clipIds.includes(clipId));
		if (owners.length !== 1 || owners[0]!.type !== 'video') {
			throw new RangeError(`Timeline image clip ${clipId} requires exactly one video track owner.`);
		}
	}
	for (const clipId of binImageIds) {
		if (tracks.some((track) => Array.isArray(track.clipIds) && track.clipIds.includes(clipId))) {
			throw new RangeError(`Project Bin image clip ${clipId} cannot have a timeline track owner.`);
		}
	}
	const selection = record(project.selection, 'selection');
	if (Array.isArray(selection.clipIds)) {
		for (const clipId of selection.clipIds.map(String)) {
			if (!timelineClips.some(({ id }) => String(id) === clipId)) {
				throw new ReferenceError(`V32 selection references missing timeline clip ${clipId}.`);
			}
		}
	}
}

function assertCanonical(value: unknown, normalized: unknown, name: string): void {
	if (JSON.stringify(value) !== JSON.stringify(normalized)) throw new TypeError(`V32 ${name} is not canonical.`);
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper V32 project');
	const expected = new Set(FRAMESCAPER_V32_PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		const unexpected = keys.find((key) => typeof key !== 'string' || !expected.has(key));
		throw new TypeError(`Framescaper V32 project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of FRAMESCAPER_V32_PROJECT_FIELDS) {
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
