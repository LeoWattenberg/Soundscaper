/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
	ProjectFeatureVideoClipRenderFallback,
	ProjectFeatureVideoRenderFallback,
} from './project-feature-requirements.ts';
import {
	projectFeatureVideoClipRenderV1Playback,
	type ProjectFeatureVideoClipRenderV1Metadata,
} from './project-feature-video-clip-render-v1.ts';

export const PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS = Object.freeze({
	track: 'framescaper:rendered-video-fallback:track',
	clip: 'framescaper:rendered-video-fallback:clip',
});

export interface ProjectFeatureVideoProjectRenderV1Metadata {
	readonly schemaVersion: 1;
	readonly role: 'project-video-render-v1';
	readonly featureId: string;
	readonly requirementId: string;
	readonly sourceId: string;
	readonly trackId: typeof PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track;
	readonly clipId: typeof PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip;
}

export type ProjectFeatureVideoRenderedFallbackMetadata =
	| ProjectFeatureVideoProjectRenderV1Metadata
	| ProjectFeatureVideoClipRenderV1Metadata;

export interface ProjectFeatureVideoRenderedFallbackProjection<Project> {
	readonly project: Project;
	readonly metadata: ProjectFeatureVideoRenderedFallbackMetadata | null;
}

type RecordValue = Readonly<Record<string, unknown>>;

interface QualifiedProjectFallback {
	readonly featureId: string;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureVideoRenderFallback;
}

interface QualifiedClipFallback {
	readonly featureId: typeof PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureVideoClipRenderFallback;
}

type QualifiedFallback = QualifiedProjectFallback | QualifiedClipFallback;

const EMPTY_RESULT = Object.freeze({ metadata: null });

/**
 * Replace preview video with one publisher-supplied full render. The current
 * manifest has no placement semantics, so the admitted source starts at frame
 * zero. Canonical project, history, audio, and Project Bin state stay intact.
 */
export function projectFeatureVideoRenderedFallbackPlayback<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
): ProjectFeatureVideoRenderedFallbackProjection<Project> {
	const projectRecord = recordValue(project, 'project');
	if (optionalDataProperty(projectRecord, 'schemaVersion', 'project') !== 9) return unchanged(project);
	const qualified = qualifyingFallback(report);
	if (!qualified) return unchanged(project);
	if (isQualifiedClipFallback(qualified)) {
		return projectFeatureVideoClipRenderV1Playback(project, qualified);
	}
	assertManifestBinding(projectRecord, qualified);
	const sources = arrayValue(dataProperty(projectRecord, 'sources', 'project'), 'project.sources');
	const source = fallbackSource(sources, qualified.fallback.sourceId);
	assertVideoGeometry(projectRecord, source);
	assertReservedIdsAvailable(projectRecord);

	const frameCount = positiveSafeInteger(
		dataProperty(source, 'frameCount', `project source ${qualified.fallback.sourceId}`),
		'Rendered video fallback frame count',
	);
	const clip = renderedClip(qualified.fallback.sourceId, frameCount);
	const track = renderedTrack();
	const clips = projectedCollection(
		arrayValue(dataProperty(projectRecord, 'clips', 'project'), 'project.clips'),
		'kind',
		'video',
		clip,
		'project.clips',
	);
	const tracks = projectedCollection(
		arrayValue(dataProperty(projectRecord, 'tracks', 'project'), 'project.tracks'),
		'type',
		'video',
		track,
		'project.tracks',
	);
	const projected = replaceDataProperties(projectRecord, { clips, tracks }) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		role: 'project-video-render-v1' as const,
		featureId: qualified.featureId,
		requirementId: qualified.requirementId,
		sourceId: qualified.fallback.sourceId,
		trackId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
		clipId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
	});
	return Object.freeze({ project: projected, metadata });
}

function unchanged<Project>(project: Project): ProjectFeatureVideoRenderedFallbackProjection<Project> {
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
		throw new RangeError('Multiple video rendered fallbacks are ambiguous for preview playback.');
	}
	const item = candidates[0]!;
	if (item.fallback.role === 'video-clip-render-v1') {
		return Object.freeze({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
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

function isQualifiedClipFallback(value: QualifiedFallback): value is QualifiedClipFallback {
	return value.fallback.role === 'video-clip-render-v1';
}

function isQualifyingItem(item: ProjectFeatureRequirementsReportItem): item is ProjectFeatureRequirementsReportItem &
	Readonly<{ fallback: ProjectFeatureVideoRenderFallback | ProjectFeatureVideoClipRenderFallback }> {
	return item.declaredDisposition === 'rendered-fallback'
		&& item.disposition === 'rendered-fallback'
		&& item.fallback?.kind === 'video'
		&& (
			(item.fallback.role === 'project-video-render-v1'
				&& (item.availability === 'unavailable' || item.availability === 'unknown'))
			|| (item.fallback.role === 'video-clip-render-v1'
				&& item.availability === 'unavailable'
				&& item.featureId === PROJECT_FEATURE_CAPABILITY_IDS.videoEffects)
		);
}

function assertManifestBinding(project: RecordValue, qualified: QualifiedProjectFallback): void {
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
	if (dataProperty(source, 'kind', `project source ${sourceId}`) !== 'video') {
		throw new RangeError(`Rendered fallback source ${sourceId} must be video.`);
	}
	return source;
}

function assertVideoGeometry(project: RecordValue, source: RecordValue): void {
	const projectRate = positiveSafeInteger(dataProperty(project, 'sampleRate', 'project'), 'Project sample rate');
	const sourceRate = positiveSafeInteger(dataProperty(source, 'sampleRate', 'rendered fallback source'), 'Rendered fallback sample rate');
	if (sourceRate !== projectRate) throw new RangeError('Rendered fallback sample rate must match the project sample rate.');
	positiveSafeInteger(dataProperty(source, 'frameCount', 'rendered fallback source'), 'Rendered fallback frame count');
	positiveSafeInteger(dataProperty(source, 'width', 'rendered fallback source'), 'Rendered fallback width');
	positiveSafeInteger(dataProperty(source, 'height', 'rendered fallback source'), 'Rendered fallback height');
	positiveFinite(dataProperty(source, 'frameRate', 'rendered fallback source'), 'Rendered fallback frame rate');
}

function assertReservedIdsAvailable(project: RecordValue): void {
	for (const [collection, id, kind] of [
		['tracks', PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track, 'track'],
		['clips', PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip, 'clip'],
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
			=== PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip)) {
		throw new RangeError('The reserved rendered-fallback clip ID collides with Project Bin state.');
	}
}

function renderedClip(sourceId: string, frameCount: number): RecordValue {
	return Object.freeze({
		id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
		kind: 'video',
		sourceId,
		title: 'Rendered video fallback',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
		trimStartFrames: 0,
		trimEndFrames: 0,
		groupId: null,
		color: 'auto',
		speedRatio: 1,
		avLinkId: null,
		binItemId: null,
		opaqueExtensions: Object.freeze({}),
		videoEffects: Object.freeze([]),
	});
}

function renderedTrack(): RecordValue {
	return Object.freeze({
		type: 'video',
		id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
		name: 'Rendered video fallback',
		clipIds: Object.freeze([PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip]),
		mute: false,
		hidden: false,
		collapsed: false,
		height: 120,
		laneGroupId: null,
		opaqueExtensions: Object.freeze({}),
	});
}

function projectedCollection(
	values: readonly unknown[],
	discriminator: string,
	target: string,
	fallback: RecordValue,
	name: string,
): readonly unknown[] {
	const output: unknown[] = [];
	let inserted = false;
	for (let index = 0; index < values.length; index += 1) {
		const candidate = values[index];
		if (!isRecord(candidate)) continue;
		if (dataProperty(candidate, discriminator, `${name}[${String(index)}]`) === target) {
			if (!inserted) output.push(fallback);
			inserted = true;
			continue;
		}
		output.push(candidate);
	}
	if (!inserted) output.push(fallback);
	return Object.freeze(output);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	if (!Number.isFinite(value) || Number(value) <= 0) throw new RangeError(`${name} must be positive.`);
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
