/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import type { MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	normalizeVideoCaptionTrackV1,
	type VideoCaptionTrackV1,
} from '../common/editor/video-caption-track-v27.ts';
import {
	normalizeVideoColorContextV1,
	normalizeVideoSourceColorInterpretationV1,
	type VideoColorContextV1,
	type VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import { deriveVideoSourceColorInterpretationV1 } from '../common/editor/video-source-color-interpretation-v27.ts';
import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import {
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
	type VideoFinishingPresetV1,
	type VideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import { normalizeFramescaperAudioFinishingV27 } from './editor-audio-finishing-v27.ts';
import {
	framescaperProjectFeatureRequirementsForV24FoundationV27,
	stripFramescaperProjectV27State,
	validateFramescaperProjectFeatureRequirementsV27,
} from './editor-project-feature-requirements-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from './editor-project-v24.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';

export const FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION = 27 as const;

export interface FramescaperProjectV27 extends Omit<FramescaperProjectV24,
	'schemaVersion' | 'featureRequirements' | 'mixer'> {
	readonly schemaVersion: 27;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly videoColorContexts: readonly VideoColorContextV1[];
	readonly videoSourceColorInterpretations: readonly VideoSourceColorInterpretationV1[];
	readonly videoVisualPresentations: readonly VideoVisualPresentationV1[];
	readonly videoProcessorStacks: readonly VideoProcessorStackV1[];
	readonly videoMotionAnalyses: readonly VideoMotionAnalysisReferenceV1[];
	readonly videoFinishingPresets: readonly VideoFinishingPresetV1[];
	readonly videoCaptionTracks: readonly VideoCaptionTrackV1[];
	readonly automationLanes: readonly AutomationLaneV21[];
	readonly mixer: MixerGraphV21;
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
	'videoFinishingPresets', 'videoCaptionTracks', 'automationLanes',
]);

export function validateFramescaperProjectV27(
	profile: unknown,
	project: unknown,
): project is FramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	const candidate = exactProject(project);
	if (data(candidate, 'schemaVersion') !== FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(data(candidate, 'schemaVersion'))}.`);
	}
	assertNoDormantNativeState(candidate);
	validateFramescaperProjectV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		framescaperProjectV24FoundationV27(profile, candidate),
	);
	validateFinishingState(candidate);
	validateFramescaperProjectFeatureRequirementsV27(profile, candidate);
	return true;
}

export function framescaperProjectV24FoundationV27(
	profile: unknown,
	project: unknown,
): FramescaperProjectV24 {
	assertFramescaperProjectV27Profile(profile);
	const candidate = exactProject(project);
	const result = structuredClone(candidate) as Record<string, unknown>;
	stripFramescaperProjectV27State(result);
	result.featureRequirements = framescaperProjectFeatureRequirementsForV24FoundationV27(
		profile,
		candidate,
	);
	return result as unknown as FramescaperProjectV24;
}

export function normalizeFramescaperProjectFinishingStateV27(
	project: Record<string, unknown>,
): void {
	project.videoColorContexts = array(project, 'videoColorContexts').map(normalizeVideoColorContextV1);
	project.videoSourceColorInterpretations = array(project, 'videoSourceColorInterpretations')
		.map(normalizeVideoSourceColorInterpretationV1);
	project.videoVisualPresentations = array(project, 'videoVisualPresentations')
		.map(normalizeVideoVisualPresentationV1);
	project.videoProcessorStacks = array(project, 'videoProcessorStacks').map(normalizeVideoProcessorStackV1);
	project.videoMotionAnalyses = array(project, 'videoMotionAnalyses')
		.map(normalizeVideoMotionAnalysisReferenceV1);
	project.videoFinishingPresets = array(project, 'videoFinishingPresets')
		.map(normalizeVideoFinishingPresetV1);
	project.videoCaptionTracks = array(project, 'videoCaptionTracks').map(normalizeVideoCaptionTrackV1);
	const audio = normalizeFramescaperAudioFinishingV27(project, {
		automationLanes: data(project, 'automationLanes'),
		mixer: data(project, 'mixer'),
	});
	project.automationLanes = audio.automationLanes;
	project.mixer = audio.mixer;
}

function validateFinishingState(project: Record<string, unknown>): void {
	const contexts = canonicalCollection(project, 'videoColorContexts', normalizeVideoColorContextV1);
	const interpretations = canonicalCollection(
		project, 'videoSourceColorInterpretations', normalizeVideoSourceColorInterpretationV1,
	);
	const presentations = canonicalCollection(
		project, 'videoVisualPresentations', normalizeVideoVisualPresentationV1,
	);
	const stacks = canonicalCollection(project, 'videoProcessorStacks', normalizeVideoProcessorStackV1);
	const analyses = canonicalCollection(
		project, 'videoMotionAnalyses', normalizeVideoMotionAnalysisReferenceV1,
	);
	const presets = canonicalCollection(project, 'videoFinishingPresets', normalizeVideoFinishingPresetV1);
	const captionTracks = canonicalCollection(project, 'videoCaptionTracks', normalizeVideoCaptionTrackV1);
	const normalizedAudio = normalizeFramescaperAudioFinishingV27(project, {
		automationLanes: data(project, 'automationLanes'), mixer: data(project, 'mixer'),
	});
	assertCanonical(data(project, 'automationLanes'), normalizedAudio.automationLanes, 'automation lanes');
	assertCanonical(data(project, 'mixer'), normalizedAudio.mixer, 'mixer graph');
	const sources = records(data(project, 'sources'), 'sources');
	const clips = records(data(project, 'clips'), 'clips');
	const projectBin = record(data(project, 'projectBin'), 'projectBin');
	const binClips = records(data(projectBin, 'clips'), 'projectBin.clips');
	const sequences = records(data(project, 'sequences'), 'sequences');
	const sequenceIds = new Set(sequences.map((sequence) => id(sequence, 'sequence')));
	const sourceById = new Map(sources.map((source) => [id(source, 'source'), source]));
	const clipIds = new Set([...clips, ...binClips].map((clip) => id(clip, 'clip')));
	assertExactReferences(contexts.map(({ sequenceId }) => sequenceId), sequenceIds, 'color context sequence');
	const interpretedSources = sources.filter(({ kind }) => kind === 'video' || kind === 'still');
	assertExactReferences(
		interpretations.map(({ sourceId }) => sourceId),
		new Set(interpretedSources.map((source) => id(source, 'interpreted source'))),
		'source color interpretation',
	);
	for (const interpretation of interpretations) {
		const source = sourceById.get(interpretation.sourceId);
		if (source?.kind !== interpretation.sourceKind) {
			throw new RangeError(`Color interpretation ${interpretation.sourceId} kind does not match its source.`);
		}
		if (interpretation.provenance !== 'user-override') {
			const derived = deriveVideoSourceColorInterpretationV1(source, interpretation.provenance === 'legacy-unmanaged-encoded'
				? { unreported: 'legacy-unmanaged-encoded' }
				: {});
			if (JSON.stringify(derived) !== JSON.stringify(interpretation)) {
				throw new RangeError(`Color interpretation ${interpretation.sourceId} does not match its source metadata or disclosed assumption.`);
			}
		}
	}
	const adjustmentIds = new Set(records(data(project, 'videoAdjustmentLayers'), 'videoAdjustmentLayers').map((item) => id(item, 'adjustment layer')));
	const maskIds = new Set(records(data(project, 'videoMaskMattes'), 'videoMaskMattes').map((item) => id(item, 'mask/matte')));
	const stackById = uniqueMap(stacks, 'processor stack');
	const ownedIdentities = projectIdentities(project);
	for (const stack of stacks) {
		addIdentity(ownedIdentities, stack.id, 'processor stack');
		if (sourceById.get(stack.sourceId)?.kind !== 'video') {
			throw new ReferenceError(`Video processor stack ${stack.id} references missing video source ${stack.sourceId}.`);
		}
	}
	for (const presentation of presentations) {
		addIdentity(ownedIdentities, presentation.id, 'visual presentation');
		assertPresentationOwner(presentation, sourceById, clipIds, adjustmentIds, maskIds);
		if (presentation.processorStackId !== null && !stackById.has(presentation.processorStackId)) {
			throw new ReferenceError(`Visual presentation ${presentation.id} references a missing processor stack.`);
		}
		for (const maskId of presentation.maskMatteIds) {
			if (!maskIds.has(maskId)) throw new ReferenceError(`Visual presentation ${presentation.id} references missing mask/matte ${maskId}.`);
		}
	}
	for (const analysis of analyses) {
		addIdentity(ownedIdentities, analysis.id, 'motion analysis');
		const stack = stackById.get(analysis.processorStackId);
		if (!stack || stack.sourceId !== analysis.sourceId || sourceById.get(analysis.sourceId)?.kind !== 'video') {
			throw new ReferenceError(`Motion analysis ${analysis.id} references a missing or mismatched source/processor stack.`);
		}
	}
	for (const preset of presets) addIdentity(ownedIdentities, preset.id, 'finishing preset');
	for (const track of captionTracks) {
		addIdentity(ownedIdentities, track.id, 'caption track');
		if (!sequenceIds.has(track.sequenceId)) throw new ReferenceError(`Caption track ${track.id} references a missing sequence.`);
	}
}

function assertPresentationOwner(
	presentation: VideoVisualPresentationV1,
	sourceById: ReadonlyMap<string, Record<string, unknown>>,
	clipIds: ReadonlySet<string>,
	adjustmentIds: ReadonlySet<string>,
	maskIds: ReadonlySet<string>,
): void {
	const { kind, id: ownerId } = presentation.owner;
	const valid = kind === 'source' ? sourceById.has(ownerId)
		: kind === 'clip' ? clipIds.has(ownerId)
			: kind === 'adjustment-layer' ? adjustmentIds.has(ownerId)
				: kind === 'generator' ? sourceById.get(ownerId)?.kind === 'generator'
					: maskIds.has(ownerId);
	if (!valid) throw new ReferenceError(`Visual presentation ${presentation.id} has a missing ${kind} owner.`);
}

function assertNoDormantNativeState(project: Record<string, unknown>): void {
	for (const field of ['nativeVideoSources', 'ofxEffects']) {
		if (Object.hasOwn(project, field)) throw new TypeError(`Framescaper V27 does not admit dormant native state ${field}.`);
	}
	for (const source of records(data(project, 'sources'), 'sources')) {
		if (Object.hasOwn(source, 'imageSequence')) {
			throw new TypeError('Framescaper V27 does not inherit V25 native image-sequence state.');
		}
	}
}

function exactProject(value: unknown): Record<string, unknown> {
	const project = record(value, 'Framescaper V27 project');
	const expected = new Set(PROJECT_FIELDS);
	const keys = Reflect.ownKeys(project);
	if (keys.length !== expected.size || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		const unexpected = keys.find((key) => typeof key !== 'string' || !expected.has(key));
		throw new TypeError(`Framescaper V27 project contains unsupported field ${String(unexpected)}.`);
	}
	for (const field of PROJECT_FIELDS) data(project, field);
	return project;
}

function projectIdentities(project: Record<string, unknown>): Set<string> {
	const identities = new Set<string>([String(data(project, 'id'))]);
	for (const field of [
		'sources', 'clips', 'tracks', 'sequences', 'subsequences', 'multicameraGroups',
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes',
	]) {
		for (const value of records(data(project, field), field)) identities.add(id(value, field));
	}
	const bin = record(data(project, 'projectBin'), 'projectBin');
	for (const value of records(data(bin, 'clips'), 'projectBin.clips')) identities.add(id(value, 'projectBin clip'));
	for (const track of records(data(project, 'tracks'), 'tracks')) {
		if (!Array.isArray(track.videoTransitions)) continue;
		for (const value of records(track.videoTransitions, 'videoTransitions')) identities.add(id(value, 'transition'));
	}
	return identities;
}

function canonicalCollection<Item>(
	project: Record<string, unknown>,
	field: string,
	normalize: (value: unknown) => Item,
): readonly Item[] {
	const raw = array(project, field);
	const normalized = raw.map(normalize);
	assertCanonical(raw, normalized, field);
	return normalized;
}

function assertExactReferences(actual: readonly string[], expected: ReadonlySet<string>, name: string): void {
	const seen = new Set<string>();
	for (const id of actual) {
		if (seen.has(id)) throw new RangeError(`${name} ${id} is duplicated.`);
		seen.add(id);
	}
	if (seen.size !== expected.size || [...expected].some((id) => !seen.has(id))) {
		throw new ReferenceError(`Every ${name} requires exactly one matching project owner.`);
	}
}

function uniqueMap<Item extends Readonly<{ id: string }>>(items: readonly Item[], name: string): Map<string, Item> {
	const result = new Map<string, Item>();
	for (const item of items) {
		if (result.has(item.id)) throw new RangeError(`${name} identity ${item.id} is duplicated.`);
		result.set(item.id, item);
	}
	return result;
}

function addIdentity(identities: Set<string>, id: string, name: string): void {
	if (identities.has(id)) throw new RangeError(`V27 ${name} identity ${id} collides with project identity.`);
	identities.add(id);
}

function assertCanonical(actual: unknown, expected: unknown, name: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`Framescaper V27 ${name} is not canonical.`);
}

function id(value: Record<string, unknown>, name: string): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError(`${name}.id must be non-empty.`);
	return value.id;
}

function data(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be data.`);
	return descriptor.value;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
	const result = data(value, key);
	if (!Array.isArray(result)) throw new TypeError(`${key} must be an array.`);
	return result;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
