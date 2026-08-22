/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoFreezeFallbackV1, type VideoFreezeFallbackV1 } from '../common/editor/video-freeze-v24.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import { normalizeVideoMaskMatteGraphV1, type VideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import { normalizeVideoVisualPresetV1, type VideoVisualPresetV1 } from '../common/editor/video-visual-preset-v24.ts';
import {
	normalizeVideoAdjustmentLayerV1,
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
	type VideoAdjustmentLayerV1,
	type VideoGeneratorClipV1,
	type VideoGeneratorSourceV1,
	type VideoStillClipV1,
	type VideoStillSourceV1,
} from '../common/editor/video-visual-model-v24.ts';
import {
	framescaperProjectFeatureRequirementsForV22FoundationV24,
	stripVisualState,
	validateFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import { admitFramescaperProjectV20Structure } from './editor-project-v20-structural-admission.ts';
import { validateFramescaperProjectV22, type FramescaperProjectV22 } from './editor-project-v22.ts';

export const FRAMESCAPER_PROJECT_V24_SCHEMA_VERSION = 24 as const;

export interface FramescaperProjectV24 extends Omit<FramescaperProjectV22, 'schemaVersion' | 'sources' | 'clips'> {
	readonly id: string;
	readonly schemaVersion: 24;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly (Readonly<Record<string, unknown>> | VideoStillSourceV1 | VideoGeneratorSourceV1)[];
	readonly clips: readonly (Readonly<Record<string, unknown>> | VideoStillClipV1 | VideoGeneratorClipV1)[];
	readonly videoAdjustmentLayers: readonly VideoAdjustmentLayerV1[];
	readonly videoVisualPresets: readonly VideoVisualPresetV1[];
	readonly videoMaskMattes: readonly VideoMaskMatteGraphV1[];
	readonly videoFreezeFallbacks: readonly VideoFreezeFallbackV1[];
}

export function validateFramescaperProjectV24(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	admitFramescaperProjectV20Structure(project);
	const candidate = record(project, 'Framescaper V24 project');
	if (data(candidate, 'schemaVersion') !== 24) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(data(candidate, 'schemaVersion'))}.`);
	}
	validateFramescaperProjectV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		framescaperProjectV22FoundationV24(profile, candidate),
	);
	validateVisualModels(candidate);
	validateFramescaperProjectFeatureRequirementsV24(profile, candidate);
	return true;
}

export function framescaperProjectV22FoundationV24(
	profile: unknown,
	project: unknown,
): FramescaperProjectV22 {
	assertFramescaperProjectV24CandidateProfile(profile);
	const candidate = record(project, 'Framescaper V24 project');
	const result = structuredClone(candidate) as Record<string, unknown>;
	stripVisualState(result);
	result.featureRequirements = framescaperProjectFeatureRequirementsForV22FoundationV24(profile, candidate);
	return result as unknown as FramescaperProjectV22;
}

export function normalizeFramescaperProjectVisualModelsV24(project: Record<string, unknown>): void {
	project.sources = records(project.sources, 'sources').map((source) => source.kind === 'still'
		? normalizeVideoStillSourceV1(source)
		: source.kind === 'generator' ? normalizeVideoGeneratorSourceV1(source) : source);
	project.clips = records(project.clips, 'clips').map((clip) => clip.kind === 'still'
		? normalizeVideoStillClipV1(clip)
		: clip.kind === 'generator' ? normalizeVideoGeneratorClipV1(clip) : clip);
	const bin = record(project.projectBin, 'projectBin');
	bin.clips = records(bin.clips, 'projectBin.clips').map((clip) => clip.kind === 'still'
		? normalizeVideoStillClipV1(clip)
		: clip.kind === 'generator' ? normalizeVideoGeneratorClipV1(clip) : clip);
	project.videoAdjustmentLayers = array(project, 'videoAdjustmentLayers').map(normalizeVideoAdjustmentLayerV1);
	project.videoVisualPresets = array(project, 'videoVisualPresets').map(normalizeVideoVisualPresetV1);
	project.videoMaskMattes = array(project, 'videoMaskMattes').map(normalizeVideoMaskMatteGraphV1);
	project.videoFreezeFallbacks = array(project, 'videoFreezeFallbacks').map(normalizeVideoFreezeFallbackV1);
}

function validateVisualModels(project: Record<string, unknown>): void {
	const sources = records(data(project, 'sources'), 'sources');
	const clips = records(data(project, 'clips'), 'clips');
	const binClips = records(data(record(data(project, 'projectBin'), 'projectBin'), 'clips'), 'projectBin.clips');
	const sourceById = new Map(sources.map((source) => [String(source.id), source]));
	const sequenceIds = new Set(records(data(project, 'sequences'), 'sequences').map(({ id }) => String(id)));
	const trackById = new Map(records(data(project, 'tracks'), 'tracks').map((track) => [String(track.id), track]));
	const identities = new Set<string>();
	for (const owner of [...sources, ...clips, ...binClips, ...trackById.values(), ...records(data(project, 'sequences'), 'sequences')]) {
		const ownerId = String(data(owner, 'id'));
		if (identities.has(ownerId)) throw new RangeError(`V24 visual identity ${ownerId} is duplicated.`);
		identities.add(ownerId);
	}
	for (const source of sources) {
		if (source.kind === 'still') assertCanonical(source, normalizeVideoStillSourceV1(source), 'still source');
		if (source.kind === 'generator') assertCanonical(source, normalizeVideoGeneratorSourceV1(source), 'generator source');
	}
	const timelineVisualIds = new Set<string>();
	for (const clip of [...clips, ...binClips]) {
		if (clip.kind !== 'still' && clip.kind !== 'generator') continue;
		const normalized = clip.kind === 'still' ? normalizeVideoStillClipV1(clip) : normalizeVideoGeneratorClipV1(clip);
		assertCanonical(clip, normalized, `${String(clip.kind)} clip`);
		const source = sourceById.get(normalized.sourceId);
		if (!source || source.kind !== normalized.kind) {
			throw new ReferenceError(`${String(clip.kind)} clip references missing matching source ${normalized.sourceId}.`);
		}
		if (!sequenceIds.has(normalized.sequenceId)) throw new ReferenceError(`Visual clip sequence ${normalized.sequenceId} is missing.`);
		if (clips.includes(clip)) timelineVisualIds.add(normalized.id);
	}
	for (const clipId of timelineVisualIds) {
		const owners = [...trackById.values()].filter((track) => Array.isArray(track.clipIds) && track.clipIds.includes(clipId));
		if (owners.length !== 1 || owners[0]!.type !== 'video') {
			throw new RangeError(`Timeline visual clip ${clipId} requires exactly one video track owner.`);
		}
	}
	const adjustments = array(project, 'videoAdjustmentLayers').map(normalizeVideoAdjustmentLayerV1);
	const presets = array(project, 'videoVisualPresets').map(normalizeVideoVisualPresetV1);
	const masks = array(project, 'videoMaskMattes').map(normalizeVideoMaskMatteGraphV1);
	const freezes = array(project, 'videoFreezeFallbacks').map(normalizeVideoFreezeFallbackV1);
	for (const adjustment of adjustments) {
		addIdentity(identities, adjustment.id, 'adjustment layer');
		if (!sequenceIds.has(adjustment.sequenceId)) throw new ReferenceError(`Adjustment sequence ${adjustment.sequenceId} is missing.`);
		for (const trackId of adjustment.targetTrackIds) {
			if (trackById.get(trackId)?.type !== 'video') throw new ReferenceError(`Adjustment target ${trackId} is not a video track.`);
		}
	}
	for (const preset of presets) addIdentity(identities, preset.id, 'visual preset');
	for (const mask of masks) {
		addIdentity(identities, mask.id, 'mask/matte');
		for (const input of mask.inputs) {
			if (!sourceById.has(input.sourceRef)) throw new ReferenceError(`Mask input source ${input.sourceRef} is missing.`);
		}
	}
	const frozenSourceIds = new Set<string>();
	for (const freeze of freezes) {
		if (frozenSourceIds.has(freeze.renderedSourceId)) {
			throw new RangeError(`Video freeze source ${freeze.renderedSourceId} has duplicate fallback authority.`);
		}
		frozenSourceIds.add(freeze.renderedSourceId);
		const renderedSource = sourceById.get(freeze.renderedSourceId);
		if (!renderedSource) throw new ReferenceError(`Video freeze source ${freeze.renderedSourceId} is missing.`);
		if (renderedSource.contentSha256 !== freeze.renderedAssetSha256) {
			throw new RangeError('Video freeze external asset digest does not match its rendered source identity.');
		}
	}
}

function assertCanonical(value: unknown, normalized: unknown, name: string): void {
	if (JSON.stringify(value) !== JSON.stringify(normalized)) throw new RangeError(`V24 ${name} is not canonical.`);
}

function addIdentity(identities: Set<string>, id: string, name: string): void {
	if (identities.has(id)) throw new RangeError(`V24 ${name} identity ${id} collides with project identity.`);
	identities.add(id);
}

function data(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be data.`);
	return descriptor.value;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
	const candidate = data(value, key);
	if (!Array.isArray(candidate)) throw new TypeError(`${key} must be an array.`);
	return candidate;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
