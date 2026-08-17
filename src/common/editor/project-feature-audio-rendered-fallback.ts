/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import {
	isMaintainedRenderedFallbackProjectSchema,
	isSoundscaperProductionProjectSchema,
} from './project-schema-version.ts';
import {
	projectFeatureAudioTrackRenderV1Playback,
	type ProjectFeatureAudioTrackRenderV1Metadata,
} from './project-feature-audio-track-render-v1.ts';
import type {
	ProjectFeatureAudioMixFallback,
	ProjectFeatureAudioTrackRenderFallback,
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
} from './project-feature-requirements.ts';

export const PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS = Object.freeze({
	track: 'soundscaper:rendered-audio-fallback:track',
	clip: 'soundscaper:rendered-audio-fallback:clip',
});

export interface ProjectFeatureAudioMixRenderV1Metadata {
	readonly schemaVersion: 1;
	readonly role: 'project-audio-mix-v1';
	readonly featureId: string;
	readonly requirementId: string;
	readonly sourceId: string;
	readonly trackId: typeof PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track;
	readonly clipId: typeof PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip;
}

export type ProjectFeatureAudioRenderedFallbackMetadata =
	| ProjectFeatureAudioMixRenderV1Metadata
	| ProjectFeatureAudioTrackRenderV1Metadata;

export interface ProjectFeatureAudioRenderedFallbackProjection<Project> {
	readonly project: Project;
	readonly metadata: ProjectFeatureAudioRenderedFallbackMetadata | null;
}

type RecordValue = Readonly<Record<string, unknown>>;

interface QualifiedMixFallback {
	readonly featureId: string;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureAudioMixFallback;
}

interface QualifiedTrackFallback {
	readonly featureId:
		| typeof PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
		| typeof PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureAudioTrackRenderFallback;
}

type QualifiedFallback = QualifiedMixFallback | QualifiedTrackFallback;

const EMPTY_RESULT = Object.freeze({ metadata: null });

/**
 * Replace editor-playback audio with one publisher-supplied whole-mix render.
 * The current manifest has no placement semantics, so the admitted source is
 * used in full from frame zero. Canonical project, history, and save state are
 * never mutated.
 */
export function projectFeatureAudioRenderedFallbackPlayback<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
): ProjectFeatureAudioRenderedFallbackProjection<Project> {
	const projectRecord = recordValue(project, 'project');
	const schemaVersion = optionalDataProperty(projectRecord, 'schemaVersion', 'project');
	if (!isMaintainedRenderedFallbackProjectSchema(schemaVersion)) return unchanged(project);
	const qualified = qualifyingFallback(report);
	if (!qualified) return unchanged(project);
	if (isQualifiedTrackFallback(qualified)) {
		return projectFeatureAudioTrackRenderV1Playback(project, qualified);
	}
	if (isSoundscaperProductionProjectSchema(schemaVersion)) return unchanged(project);
	assertManifestBinding(projectRecord, qualified);
	const sources = arrayValue(dataProperty(projectRecord, 'sources', 'project'), 'project.sources');
	const source = fallbackSource(sources, qualified.fallback.sourceId);
	assertAudioGeometry(projectRecord, source);
	assertAdmUnsupported(projectRecord);
	assertReservedIdsAvailable(projectRecord);

	const frameCount = positiveSafeInteger(
		dataProperty(source, 'frameCount', `project source ${qualified.fallback.sourceId}`),
		'Rendered audio fallback frame count',
	);
	const sampleRate = positiveSafeInteger(dataProperty(projectRecord, 'sampleRate', 'project'), 'Project sample rate');
	const clip = renderedClip(qualified.fallback.sourceId, frameCount);
	const track = renderedTrack(sampleRate);
	const clips = Object.freeze([
		clip,
		...arrayValue(dataProperty(projectRecord, 'clips', 'project'), 'project.clips')
			.filter((candidate, index) => isRecord(candidate)
				&& dataProperty(candidate, 'kind', `project.clips[${String(index)}]`) === 'video'),
	]);
	const tracks = projectedTracks(
		arrayValue(dataProperty(projectRecord, 'tracks', 'project'), 'project.tracks'),
		track,
	);
	const projected = replaceDataProperties(projectRecord, {
		clips,
		tracks,
		mixer: Object.freeze({ groups: Object.freeze([]), sends: Object.freeze([]), routes: Object.freeze({}) }),
		master: Object.freeze({
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			envelope: Object.freeze([]),
			collapsed: true,
			effectsActive: false,
			effects: Object.freeze([]),
		}),
	}) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		role: 'project-audio-mix-v1' as const,
		featureId: qualified.featureId,
		requirementId: qualified.requirementId,
		sourceId: qualified.fallback.sourceId,
		trackId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		clipId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
	});
	return Object.freeze({ project: projected, metadata });
}

function unchanged<Project>(project: Project): ProjectFeatureAudioRenderedFallbackProjection<Project> {
	return Object.freeze({ project, ...EMPTY_RESULT });
}

function qualifyingFallback(
	report: ProjectFeatureRequirementsReport | null | undefined,
): QualifiedFallback | null {
	if (report?.compatible !== false || report.format !== 'soundscaper-project' || !Array.isArray(report.items)) {
		return null;
	}
	const candidates = report.items.filter(isQualifyingItem);
	if (candidates.length === 0) return null;
	if (candidates.length !== 1) {
		throw new RangeError('Multiple audio rendered fallbacks are ambiguous for editor playback.');
	}
	const item = candidates[0]!;
	if (item.fallback.role === 'audio-track-render-v1') {
		return Object.freeze({
			featureId: item.featureId as QualifiedTrackFallback['featureId'],
			requirementId: canonicalString(item.requirementId, 'Rendered fallback requirement ID'),
			fallback: item.fallback,
		});
	}
	return Object.freeze({
		featureId: canonicalString(item.featureId, 'Rendered fallback feature ID'),
		requirementId: canonicalString(item.requirementId, 'Rendered fallback requirement ID'),
		fallback: item.fallback,
	});
}

function isQualifyingItem(item: ProjectFeatureRequirementsReportItem): item is ProjectFeatureRequirementsReportItem &
	Readonly<{ fallback: ProjectFeatureAudioMixFallback | ProjectFeatureAudioTrackRenderFallback }> {
	if (item.declaredDisposition !== 'rendered-fallback'
		|| item.disposition !== 'rendered-fallback'
		|| item.fallback?.kind !== 'audio') return false;
	if (item.fallback.role === 'project-audio-mix-v1') {
		return item.availability === 'unavailable' || item.availability === 'unknown';
	}
	// The track relationship is first-party, so its feature is always known.
	return item.fallback.role === 'audio-track-render-v1'
		&& item.availability === 'unavailable'
		&& (item.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
			|| item.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze);
}

function isQualifiedTrackFallback(qualified: QualifiedFallback): qualified is QualifiedTrackFallback {
	return qualified.fallback.role === 'audio-track-render-v1';
}

function assertManifestBinding(project: RecordValue, qualified: QualifiedMixFallback): void {
	const manifest = recordValue(dataProperty(project, 'featureRequirements', 'project'), 'project.featureRequirements');
	const requirements = arrayValue(
		dataProperty(manifest, 'requirements', 'project.featureRequirements'),
		'project.featureRequirements.requirements',
	);
	const matching = requirements.filter((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.featureRequirements.requirements[${String(index)}]`)
			=== qualified.requirementId);
	if (matching.length !== 1) {
		throw new Error('The rendered fallback descriptor does not match one project manifest requirement.');
	}
	const requirement = matching[0]! as RecordValue;
	const fallback = recordValue(
		dataProperty(requirement, 'fallback', 'project feature requirement'),
		'project feature requirement fallback',
	);
	if (
		dataProperty(requirement, 'featureId', 'project feature requirement')
			!== qualified.featureId
		|| dataProperty(requirement, 'disposition', 'project feature requirement') !== 'rendered-fallback'
		|| dataProperty(fallback, 'role', 'project feature requirement fallback') !== qualified.fallback.role
		|| dataProperty(fallback, 'kind', 'project feature requirement fallback') !== qualified.fallback.kind
		|| dataProperty(fallback, 'sourceId', 'project feature requirement fallback') !== qualified.fallback.sourceId
		|| dataProperty(fallback, 'sha256', 'project feature requirement fallback') !== qualified.fallback.sha256
	) {
		throw new Error('The rendered fallback descriptor does not match the project manifest.');
	}
}

function fallbackSource(sources: readonly unknown[], sourceId: string): RecordValue {
	const matches = sources.filter((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.sources[${String(index)}]`) === sourceId);
	if (matches.length !== 1) throw new ReferenceError(`Rendered fallback source ${sourceId} is missing or duplicated.`);
	const source = matches[0]! as RecordValue;
	if (dataProperty(source, 'kind', `project source ${sourceId}`) !== 'audio') {
		throw new RangeError(`Rendered fallback source ${sourceId} must be audio.`);
	}
	return source;
}

function assertAudioGeometry(project: RecordValue, source: RecordValue): void {
	const projectRate = positiveSafeInteger(dataProperty(project, 'sampleRate', 'project'), 'Project sample rate');
	const sourceRate = positiveSafeInteger(dataProperty(source, 'sampleRate', 'rendered fallback source'), 'Rendered fallback sample rate');
	if (sourceRate !== projectRate) throw new RangeError('Rendered fallback sample rate must match the project sample rate.');
	const masterChannels = positiveSafeInteger(
		dataProperty(project, 'masterChannels', 'project'),
		'Project master channel count',
	);
	const sourceChannels = positiveSafeInteger(
		dataProperty(source, 'channelCount', 'rendered fallback source'),
		'Rendered fallback channel count',
	);
	if (sourceChannels !== masterChannels) {
		throw new RangeError('Rendered fallback channel count must match the project master channel count.');
	}
	if (sourceChannels > 2) {
		throw new RangeError('Rendered fallback editor playback currently supports mono or stereo, not surround audio.');
	}
	positiveSafeInteger(dataProperty(source, 'frameCount', 'rendered fallback source'), 'Rendered fallback frame count');
}

function assertAdmUnsupported(project: RecordValue): void {
	const metadata = recordValue(dataProperty(project, 'metadata', 'project'), 'project.metadata');
	if (dataProperty(metadata, 'adm', 'project.metadata') !== null) {
		throw new RangeError('Rendered fallback editor playback does not support ADM project routing.');
	}
}

function assertReservedIdsAvailable(project: RecordValue): void {
	for (const [collection, id, kind] of [
		['tracks', PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track, 'track'],
		['clips', PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip, 'clip'],
	] as const) {
		const values = arrayValue(dataProperty(project, collection, 'project'), `project.${collection}`);
		if (values.some((candidate, index) => isRecord(candidate)
			&& dataProperty(candidate, 'id', `project.${collection}[${String(index)}]`) === id)) {
			throw new RangeError(`The reserved rendered-fallback ${kind} ID collides with project state.`);
		}
	}
	const projectBin = recordValue(dataProperty(project, 'projectBin', 'project'), 'project.projectBin');
	const binClips = arrayValue(dataProperty(projectBin, 'clips', 'project.projectBin'), 'project.projectBin.clips');
	if (binClips.some((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.projectBin.clips[${String(index)}]`)
			=== PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip)) {
		throw new RangeError('The reserved rendered-fallback clip ID collides with Project Bin state.');
	}
}

function renderedClip(sourceId: string, frameCount: number): RecordValue {
	return Object.freeze({
		id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
		kind: 'audio',
		sourceId,
		title: 'Rendered audio fallback',
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

function renderedTrack(sampleRate: number): RecordValue {
	return Object.freeze({
		type: 'audio',
		id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		name: 'Rendered audio fallback',
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		armed: false,
		displayMode: 'waveform',
		color: '#4f87c8',
		spectrogram: Object.freeze({
			scale: 'logarithmic',
			minimumFrequency: Math.min(20, Math.max(0, sampleRate / 4)),
			maximumFrequency: Math.min(20_000, sampleRate / 2),
			windowSize: 2_048,
			windowType: 'hann',
			gain: 20,
			range: 80,
		}),
		envelope: Object.freeze([]),
		effectsActive: false,
		effects: Object.freeze([]),
		clipIds: Object.freeze([PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip]),
		collapsed: false,
		height: 160,
		laneGroupId: null,
		opaqueExtensions: Object.freeze({}),
	});
}

function projectedTracks(values: readonly unknown[], fallback: RecordValue): readonly unknown[] {
	const output: unknown[] = [];
	let inserted = false;
	for (let index = 0; index < values.length; index += 1) {
		const candidate = values[index];
		if (!isRecord(candidate)) continue;
		if (dataProperty(candidate, 'type', `project.tracks[${String(index)}]`) === 'audio') {
			if (!inserted) output.push(fallback);
			inserted = true;
			continue;
		}
		output.push(candidate);
	}
	if (!inserted) output.unshift(fallback);
	return Object.freeze(output);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
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

function optionalDataProperty(value: RecordValue, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an own data property.`);
	return descriptor.value;
}

function replaceDataProperties(value: RecordValue, replacements: Record<string, unknown>): RecordValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const [key, replacement] of Object.entries(replacements)) {
		descriptors[key] = { configurable: true, enumerable: true, writable: true, value: replacement };
	}
	return Object.freeze(Object.create(Object.getPrototypeOf(value) as object | null, descriptors) as RecordValue);
}
