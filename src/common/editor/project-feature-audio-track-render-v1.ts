/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import type { ProjectFeatureAudioTrackRenderFallback } from './project-feature-requirements.ts';
import { normalizeAudioTrackFreezeV1, type AudioTrackFreezeV1 } from './audio-track-freeze-v21.ts';
import { normalizeMixerGraphV21 } from './mixer-graph-v21.ts';

export const PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS = Object.freeze({
	clip: 'soundscaper:rendered-audio-fallback:track-clip',
});

export interface ProjectFeatureAudioTrackRenderV1Descriptor {
	readonly featureId:
		| typeof PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
		| typeof PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureAudioTrackRenderFallback;
}

export interface ProjectFeatureAudioTrackRenderV1Metadata {
	readonly schemaVersion: 1;
	readonly role: 'audio-track-render-v1';
	readonly featureId: ProjectFeatureAudioTrackRenderV1Descriptor['featureId'];
	readonly requirementId: string;
	readonly sourceId: string;
	readonly targetTrackId: string;
	readonly clipId: typeof PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip;
}

export interface ProjectFeatureAudioTrackRenderV1Projection<Project> {
	readonly project: Project;
	readonly metadata: ProjectFeatureAudioTrackRenderV1Metadata;
}

type RecordValue = Readonly<Record<string, unknown>>;

/**
 * Replace one audio track's clip lane and effect rack with its complete
 * publisher-supplied render. Track identity, gain, pan, mute, solo, envelope,
 * and routing stay canonical, so the rest of the mix keeps playing natively;
 * only the rack and the lane it processed become neutral.
 */
export function projectFeatureAudioTrackRenderV1Playback<Project extends object>(
	project: Project,
	descriptor: ProjectFeatureAudioTrackRenderV1Descriptor,
): ProjectFeatureAudioTrackRenderV1Projection<Project> {
	const projectRecord = recordValue(project, 'project');
	assertDescriptor(descriptor);
	assertManifestBinding(projectRecord, descriptor);
	assertAdmUnsupported(projectRecord);
	const tracks = arrayValue(dataProperty(projectRecord, 'tracks', 'project'), 'project.tracks');
	const target = exactRecordById(tracks, descriptor.fallback.targetTrackId, 'target track');
	if (dataProperty(target.value, 'type', target.name) !== 'audio') {
		throw new RangeError('An audio track rendered fallback target must be an audio track.');
	}
	const freeze = descriptor.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
		? normalizeAudioTrackFreezeV1(dataProperty(target.value, 'audioFreeze', target.name))
		: null;
	if (freeze === null) assertActiveEffectRack(target.value, target.name);
	const sources = arrayValue(dataProperty(projectRecord, 'sources', 'project'), 'project.sources');
	const fallbackSource = exactRecordById(sources, descriptor.fallback.sourceId, 'fallback source').value;
	const clips = arrayValue(dataProperty(projectRecord, 'clips', 'project'), 'project.clips');
	const laneClipIds = targetLaneClipIds(target.value, target.name);
	const placement = freeze === null
		? Object.freeze({ startFrame: 0, frameCount: laneExtentFrames(
			clips, laneClipIds, descriptor.fallback.sourceId, target.name,
		) })
		: freezePlacement(clips, laneClipIds, descriptor, fallbackSource, freeze, target.name);
	assertSourceGeometry(projectRecord, fallbackSource, placement.frameCount);
	assertReservedClipIdAvailable(projectRecord, clips);

	const renderedClip = renderedLaneClip(
		descriptor.fallback.sourceId,
		placement.startFrame,
		placement.frameCount,
		freeze !== null,
	);
	const projectedClips: unknown[] = [];
	let inserted = false;
	for (const clip of clips) {
		if (isRecord(clip) && laneClipIds.has(dataProperty(clip, 'id', 'project clip') as string)) {
			if (!inserted) projectedClips.push(renderedClip);
			inserted = true;
			continue;
		}
		projectedClips.push(clip);
	}
	if (!inserted) projectedClips.unshift(renderedClip);
	const targetAuthority = freeze === null ? target.value : removeDataProperties(target.value, ['audioFreeze']);
	const projectedTarget = replaceDataProperties(targetAuthority, {
		clipIds: Object.freeze([PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip]),
		effectsActive: false,
		effects: Object.freeze([]),
	});
	const projectedTracks = Object.freeze(
		tracks.map((track, index) => index === target.index ? projectedTarget : track),
	);
	const replacements: Record<string, unknown> = {
		clips: Object.freeze(projectedClips),
		tracks: projectedTracks,
	};
	if (Object.hasOwn(projectRecord, 'automationLanes')) {
		replacements.automationLanes = projectedAutomationLanes(projectRecord, descriptor.fallback.targetTrackId);
	}
	if (Object.hasOwn(projectRecord, 'mixer')) {
		replacements.mixer = projectedMixerGraph(projectRecord, descriptor.fallback.targetTrackId);
	}
	const projected = replaceDataProperties(projectRecord, replacements) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		role: 'audio-track-render-v1' as const,
		featureId: descriptor.featureId,
		requirementId: descriptor.requirementId,
		sourceId: descriptor.fallback.sourceId,
		targetTrackId: descriptor.fallback.targetTrackId,
		clipId: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip,
	});
	return Object.freeze({ project: projected, metadata });
}

function assertDescriptor(descriptor: ProjectFeatureAudioTrackRenderV1Descriptor): void {
	if (descriptor.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
		&& descriptor.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze) {
		throw new RangeError('An audio track rendered fallback requires the maintained audio-effects feature.');
	}
	canonicalString(descriptor.requirementId, 'Audio track rendered fallback requirement ID');
	if (descriptor.fallback.role !== 'audio-track-render-v1' || descriptor.fallback.kind !== 'audio') {
		throw new RangeError('An audio track rendered fallback descriptor has the wrong role or kind.');
	}
	canonicalString(descriptor.fallback.sourceId, 'Audio track rendered fallback source ID');
	canonicalString(descriptor.fallback.targetTrackId, 'Audio track rendered fallback target track ID');
}

function assertManifestBinding(
	project: RecordValue,
	descriptor: ProjectFeatureAudioTrackRenderV1Descriptor,
): void {
	const manifest = recordValue(dataProperty(project, 'featureRequirements', 'project'), 'project.featureRequirements');
	const requirements = arrayValue(
		dataProperty(manifest, 'requirements', 'project.featureRequirements'),
		'project.featureRequirements.requirements',
	);
	const matches = requirements.filter((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.featureRequirements.requirements[${String(index)}]`)
			=== descriptor.requirementId);
	if (matches.length !== 1) {
		throw new Error('The rendered fallback descriptor does not match one project manifest requirement.');
	}
	const requirement = matches[0]! as RecordValue;
	const fallback = recordValue(
		dataProperty(requirement, 'fallback', 'project feature requirement'),
		'project feature requirement fallback',
	);
	if (
		dataProperty(requirement, 'featureId', 'project feature requirement') !== descriptor.featureId
		|| dataProperty(requirement, 'disposition', 'project feature requirement') !== 'rendered-fallback'
		|| dataProperty(fallback, 'role', 'project feature requirement fallback') !== descriptor.fallback.role
		|| dataProperty(fallback, 'kind', 'project feature requirement fallback') !== descriptor.fallback.kind
		|| dataProperty(fallback, 'sourceId', 'project feature requirement fallback') !== descriptor.fallback.sourceId
		|| dataProperty(fallback, 'sha256', 'project feature requirement fallback') !== descriptor.fallback.sha256
		|| dataProperty(fallback, 'targetTrackId', 'project feature requirement fallback')
			!== descriptor.fallback.targetTrackId
	) throw new Error('The rendered fallback descriptor does not match the project manifest.');
}

function assertActiveEffectRack(target: RecordValue, name: string): void {
	if (dataProperty(target, 'effectsActive', name) === false) {
		throw new RangeError('An audio track rendered fallback target requires an active effect rack.');
	}
	const effects = arrayValue(dataProperty(target, 'effects', name), `${name}.effects`);
	if (!effects.some((effect) => isRecord(effect)
		&& optionalDataProperty(effect, 'enabled', `${name} effect`) !== false
		&& optionalDataProperty(effect, 'bypassed', `${name} effect`) !== true)) {
		throw new RangeError('An audio track rendered fallback target requires at least one enabled audio effect.');
	}
}

function freezePlacement(
	clips: readonly unknown[],
	laneClipIds: ReadonlySet<string>,
	descriptor: ProjectFeatureAudioTrackRenderV1Descriptor,
	fallbackSource: RecordValue,
	freeze: AudioTrackFreezeV1,
	name: string,
): Readonly<{ startFrame: number; frameCount: number }> {
	if (freeze.derivedSourceId !== descriptor.fallback.sourceId) {
		throw new Error('The frozen track fallback no longer matches its derived source relationship.');
	}
	if (dataProperty(fallbackSource, 'contentSha256', 'frozen fallback source')
		!== descriptor.fallback.sha256) {
		throw new Error('The frozen track fallback content digest no longer matches its manifest.');
	}
	for (const clipId of laneClipIds) {
		const clip = exactRecordById(clips, clipId, 'frozen target lane clip').value;
		if (dataProperty(clip, 'sourceId', `frozen target lane clip ${clipId}`)
			=== descriptor.fallback.sourceId) {
			throw new RangeError(`Frozen fallback target ${name} no longer retains editable authority.`);
		}
	}
	return Object.freeze({ startFrame: freeze.renderStartFrame, frameCount: freeze.renderFrameCount });
}

function targetLaneClipIds(track: RecordValue, name: string): ReadonlySet<string> {
	const clipIds = arrayValue(dataProperty(track, 'clipIds', name), `${name}.clipIds`);
	if (clipIds.length === 0) {
		throw new RangeError('An audio track rendered fallback target requires at least one timeline clip.');
	}
	const laneClipIds = new Set<string>();
	for (const clipId of clipIds) {
		laneClipIds.add(canonicalString(clipId, `${name} clip ID`));
	}
	return laneClipIds;
}

function laneExtentFrames(
	clips: readonly unknown[],
	laneClipIds: ReadonlySet<string>,
	fallbackSourceId: string,
	name: string,
): number {
	let extentFrames = 0;
	for (const clipId of laneClipIds) {
		const clip = exactRecordById(clips, clipId, 'target lane clip').value;
		if (dataProperty(clip, 'kind', `target lane clip ${clipId}`) === 'video') {
			throw new RangeError('An audio track rendered fallback target must reference only audio clips.');
		}
		if (dataProperty(clip, 'sourceId', `target lane clip ${clipId}`) === fallbackSourceId) {
			throw new RangeError('An audio track rendered fallback must differ from its target canonical sources.');
		}
		const start = nonNegativeSafeInteger(
			dataProperty(clip, 'timelineStartFrame', `target lane clip ${clipId}`),
			'Audio track rendered fallback clip start',
		);
		const duration = positiveSafeInteger(
			dataProperty(clip, 'durationFrames', `target lane clip ${clipId}`),
			'Audio track rendered fallback clip duration',
		);
		extentFrames = Math.max(extentFrames, start + duration);
	}
	if (extentFrames < 1) {
		throw new RangeError(`Audio track rendered fallback target ${name} has an empty lane extent.`);
	}
	return extentFrames;
}

function assertSourceGeometry(
	project: RecordValue,
	fallbackSource: RecordValue,
	extentFrames: number,
): void {
	if (dataProperty(fallbackSource, 'kind', 'fallback source') !== 'audio') {
		throw new RangeError('An audio track rendered fallback source must be audio.');
	}
	const projectRate = positiveSafeInteger(dataProperty(project, 'sampleRate', 'project'), 'Project sample rate');
	const sourceRate = positiveSafeInteger(
		dataProperty(fallbackSource, 'sampleRate', 'fallback source'),
		'Audio track rendered fallback sample rate',
	);
	if (sourceRate !== projectRate) {
		throw new RangeError('Audio track rendered fallback sample rate must match the project sample rate.');
	}
	const channelCount = positiveSafeInteger(
		dataProperty(fallbackSource, 'channelCount', 'fallback source'),
		'Audio track rendered fallback channel count',
	);
	if (channelCount > 2) {
		throw new RangeError('Audio track rendered fallback playback currently supports mono or stereo, not surround audio.');
	}
	const frameCount = positiveSafeInteger(
		dataProperty(fallbackSource, 'frameCount', 'fallback source'),
		'Audio track rendered fallback frame count',
	);
	if (frameCount !== extentFrames) {
		throw new RangeError('Audio track rendered fallback frame count must equal the target track extent.');
	}
}

function assertAdmUnsupported(project: RecordValue): void {
	const metadata = recordValue(dataProperty(project, 'metadata', 'project'), 'project.metadata');
	if (dataProperty(metadata, 'adm', 'project.metadata') !== null) {
		throw new RangeError('Audio track rendered fallback playback does not support ADM project routing.');
	}
}

function assertReservedClipIdAvailable(project: RecordValue, clips: readonly unknown[]): void {
	if (clips.some((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.clips[${String(index)}]`)
			=== PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip)) {
		throw new RangeError('The reserved rendered-fallback clip ID collides with project state.');
	}
	const projectBin = recordValue(dataProperty(project, 'projectBin', 'project'), 'project.projectBin');
	const binClips = arrayValue(dataProperty(projectBin, 'clips', 'project.projectBin'), 'project.projectBin.clips');
	if (binClips.some((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.projectBin.clips[${String(index)}]`)
			=== PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip)) {
		throw new RangeError('The reserved rendered-fallback clip ID collides with Project Bin state.');
	}
}

function renderedLaneClip(
	sourceId: string,
	timelineStartFrame: number,
	frameCount: number,
	v21: boolean,
): RecordValue {
	return Object.freeze({
		id: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip,
		kind: 'audio',
		sourceId,
		title: 'Rendered track fallback',
		timelineStartFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
		trimStartFrames: 0,
		trimEndFrames: 0,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
		envelope: Object.freeze([]),
		groupId: null,
		color: 'auto',
		pitchCents: 0,
		speedRatio: 1,
		preserveFormants: false,
		stretchToTempo: false,
		renderCacheRevision: 0,
		avLinkId: null,
		binItemId: null,
		opaqueExtensions: Object.freeze({}),
		...(v21 ? {
			anchor: 'sample',
			musicalStartBeat: null,
			musicalExtent: 'fixedSamples',
			musicalDurationBeats: null,
			warpMap: null,
		} : {}),
	});
}

function projectedAutomationLanes(project: RecordValue, targetTrackId: string): readonly unknown[] {
	const lanes = arrayValue(dataProperty(project, 'automationLanes', 'project'), 'project.automationLanes');
	return Object.freeze(lanes.filter((candidate, index) => {
		const lane = recordValue(candidate, `project.automationLanes[${String(index)}]`);
		const address = recordValue(
			dataProperty(lane, 'address', `project.automationLanes[${String(index)}]`),
			`project.automationLanes[${String(index)}].address`,
		);
		if (dataProperty(address, 'kind', 'automation address') !== 'effect') return true;
		const strip = recordValue(dataProperty(address, 'strip', 'automation address'), 'automation address.strip');
		return dataProperty(strip, 'kind', 'automation address.strip') !== 'track'
			|| dataProperty(strip, 'id', 'automation address.strip') !== targetTrackId;
	}));
}

function projectedMixerGraph(project: RecordValue, targetTrackId: string): unknown {
	const mixer = recordValue(dataProperty(project, 'mixer', 'project'), 'project.mixer');
	if (!Object.hasOwn(mixer, 'edges')) return mixer;
	const graph = normalizeMixerGraphV21(mixer);
	return normalizeMixerGraphV21({
		...graph,
		edges: graph.edges.filter((edge) => edge.destination.kind !== 'effect-sidechain'
			|| edge.destination.strip.kind !== 'track'
			|| edge.destination.strip.id !== targetTrackId),
	});
}

function exactRecordById(
	values: readonly unknown[],
	id: string,
	label: string,
): Readonly<{ value: RecordValue; index: number; name: string }> {
	const matches: Array<Readonly<{ value: RecordValue; index: number }>> = [];
	for (let index = 0; index < values.length; index += 1) {
		const candidate = values[index];
		if (isRecord(candidate) && dataProperty(candidate, 'id', `${label}[${String(index)}]`) === id) {
			matches.push({ value: candidate, index });
		}
	}
	if (matches.length !== 1) {
		throw new ReferenceError(`An audio track rendered fallback requires exactly one ${label} ${id}.`);
	}
	return Object.freeze({ ...matches[0]!, name: `${label} ${id}` });
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function canonicalString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${name} must be a non-empty canonical string.`);
	}
	return value;
}

function arrayValue(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(value: unknown, name: string): RecordValue {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function dataProperty(value: RecordValue, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}

/** An absent inertness flag means active; an accessor is still refused. */
function optionalDataProperty(value: RecordValue, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function replaceDataProperties(value: RecordValue, replacements: Record<string, unknown>): RecordValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const [key, replacement] of Object.entries(replacements)) {
		descriptors[key] = { configurable: true, enumerable: true, writable: true, value: replacement };
	}
	return Object.freeze(Object.create(Object.getPrototypeOf(value) as object | null, descriptors) as RecordValue);
}

function removeDataProperties(value: RecordValue, fields: readonly string[]): RecordValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const field of fields) delete descriptors[field];
	return Object.freeze(Object.create(
		Object.getPrototypeOf(value) as object | null,
		descriptors,
	) as RecordValue);
}
