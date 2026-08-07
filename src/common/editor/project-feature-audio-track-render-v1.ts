/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import type { ProjectFeatureAudioTrackRenderFallback } from './project-feature-requirements.ts';

export const PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS = Object.freeze({
	clip: 'soundscaper:rendered-audio-fallback:track-clip',
});

export interface ProjectFeatureAudioTrackRenderV1Descriptor {
	readonly featureId: typeof PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureAudioTrackRenderFallback;
}

export interface ProjectFeatureAudioTrackRenderV1Metadata {
	readonly schemaVersion: 1;
	readonly role: 'audio-track-render-v1';
	readonly featureId: typeof PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
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
	if (dataProperty(target.value, 'effectsActive', target.name) === false) {
		throw new RangeError('An audio track rendered fallback target requires an active effect rack.');
	}
	const effects = arrayValue(dataProperty(target.value, 'effects', target.name), `${target.name}.effects`);
	if (!effects.some((effect) => isRecord(effect)
		&& optionalDataProperty(effect, 'enabled', `${target.name} effect`) !== false
		&& optionalDataProperty(effect, 'bypassed', `${target.name} effect`) !== true)) {
		throw new RangeError('An audio track rendered fallback target requires at least one enabled audio effect.');
	}
	const sources = arrayValue(dataProperty(projectRecord, 'sources', 'project'), 'project.sources');
	const fallbackSource = exactRecordById(sources, descriptor.fallback.sourceId, 'fallback source').value;
	const clips = arrayValue(dataProperty(projectRecord, 'clips', 'project'), 'project.clips');
	const laneClipIds = targetLaneClipIds(target.value, target.name);
	const extentFrames = laneExtentFrames(clips, laneClipIds, descriptor.fallback.sourceId, target.name);
	assertSourceGeometry(projectRecord, fallbackSource, extentFrames);
	assertReservedClipIdAvailable(projectRecord, clips);

	const renderedClip = renderedLaneClip(descriptor.fallback.sourceId, extentFrames);
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
	const projectedTarget = replaceDataProperties(target.value, {
		clipIds: Object.freeze([PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip]),
		effectsActive: false,
		effects: Object.freeze([]),
	});
	const projectedTracks = Object.freeze(
		tracks.map((track, index) => index === target.index ? projectedTarget : track),
	);
	const projected = replaceDataProperties(projectRecord, {
		clips: Object.freeze(projectedClips),
		tracks: projectedTracks,
	}) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		role: 'audio-track-render-v1' as const,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		requirementId: descriptor.requirementId,
		sourceId: descriptor.fallback.sourceId,
		targetTrackId: descriptor.fallback.targetTrackId,
		clipId: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip,
	});
	return Object.freeze({ project: projected, metadata });
}

function assertDescriptor(descriptor: ProjectFeatureAudioTrackRenderV1Descriptor): void {
	if (descriptor.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioEffects) {
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

function renderedLaneClip(sourceId: string, frameCount: number): RecordValue {
	return Object.freeze({
		id: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip,
		kind: 'audio',
		sourceId,
		title: 'Rendered track fallback',
		timelineStartFrame: 0,
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
