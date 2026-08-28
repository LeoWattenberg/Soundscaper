/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import {
	framescaperProjectForCommandConsumersRetime,
	framescaperProjectForRuntimeConsumersRetime,
} from './editor-project-retime-runtime.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectRetimeFoundationTransitions } from './editor-project-transitions-validation.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectTransitionsFoundationVisual } from './editor-project-visual-validation.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	framescaperProjectVisualFoundationFinishing,
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing-validation.ts';

type DataRecord = Record<string, unknown>;

/** Project selected finishing through the maintained retime playback engine and retain visual visuals. */
export function framescaperProjectForRuntimeConsumersFinishing(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	const base = framescaperProjectForRuntimeConsumersRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		framescaperProjectRetimeFoundationFinishing(profile, project),
	) as unknown as DataRecord;
	const result = mergeSelectedState(base, project, true);
	return brandRuntimeProjectProjection(Object.freeze(result) as RuntimeClipProject) as Readonly<DataRecord>;
}

/** Authored command view: inherited command helpers see retime state while visual visuals remain addressable. */
export function framescaperProjectForCommandConsumersFinishing(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	const base = framescaperProjectForCommandConsumersRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		framescaperProjectRetimeFoundationFinishing(profile, project),
	) as unknown as DataRecord;
	const result = Object.freeze(mergeSelectedState(base, project, false)) as RuntimeClipProject;
	return brandRuntimeProjectProjection(result) as Readonly<DataRecord>;
}

/** Dedicated common-clipboard view: visuals impersonate video only while the descriptor is built. */
export function framescaperProjectForEditClipboardConsumersFinishing(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectFinishing(profile, projectValue);
	const projected = structuredClone(
		framescaperProjectForCommandConsumersFinishing(profile, projectValue),
	) as DataRecord;
	const runtime = framescaperProjectForRuntimeConsumersFinishing(profile, projectValue) as DataRecord;
	const runtimeClips = new Map(records(runtime.clips, 'finishing clipboard runtime clips').map((clip) => [
		stableId(clip), clip,
	]));
	projected.sources = records(projected.sources, 'finishing clipboard sources').map((source) => (
		isVisual(source) ? { ...source, kind: 'video' } : source
	));
	projected.clips = records(projected.clips, 'finishing clipboard clips').map((clip) => (
		isVisual(clip) ? {
			...runtimeClips.get(stableId(clip)),
			kind: 'video',
			title: sourceName(projected.sources, clip.sourceId),
			trimStartFrames: 0,
			trimEndFrames: 0,
			groupId: null,
			color: 'auto',
			speedRatio: 1,
			avLinkId: null,
			binItemId: null,
			opaqueExtensions: {},
			videoEffects: [],
			retimeMap: null,
			videoComposition: structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		} : clip
	));
	const bin = record(projected.projectBin, 'finishing clipboard project bin');
	bin.clips = records(bin.clips, 'finishing clipboard bin clips').map((clip) => (
		isVisual(clip) ? {
			...clip,
			kind: 'video',
			videoComposition: structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		} : clip
	));
	return Object.freeze(projected);
}

function sourceName(sourcesValue: unknown, sourceId: unknown): string {
	const source = records(sourcesValue, 'finishing clipboard sources').find(({ id }) => id === sourceId);
	return typeof source?.name === 'string' && source.name ? source.name : 'Visual';
}

export function framescaperProjectRetimeFoundationFinishing(profile: unknown, project: FramescaperProjectFinishing) {
	const visual = framescaperProjectVisualFoundationFinishing(profile, project);
	const transitions = framescaperProjectTransitionsFoundationVisual(FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE, visual);
	return framescaperProjectRetimeFoundationTransitions(FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE, transitions);
}

function mergeSelectedState(baseValue: DataRecord, project: FramescaperProjectFinishing, runtime: boolean): DataRecord {
	const base = structuredClone(baseValue) as DataRecord;
	if (runtime) base.schemaVersion =  1;
	const canonical = project as unknown as Readonly<DataRecord>;
	const visualSources = records(canonical.sources, 'finishing sources').filter(isVisual);
	const visualClips = records(canonical.clips, 'finishing clips').filter(isVisual);
	const canonicalBin = record(canonical.projectBin, 'finishing project bin');
	const visualBin = records(canonicalBin.clips, 'finishing project bin clips').filter(isVisual);
	base.sources = [...records(base.sources, 'runtime sources'), ...structuredClone(visualSources)];
	base.clips = [
		...records(base.clips, 'runtime clips'),
		...visualClips.map((clip) => runtimeClip(project, clip)),
	];
	const baseBin = record(base.projectBin, 'runtime project bin');
	baseBin.clips = [
		...records(baseBin.clips, 'runtime project bin clips'),
		...visualBin.map((clip) => runtimeClip(project, clip)),
	];
	base.tracks = mergeTracks(base.tracks, canonical.tracks, new Set(visualClips.map(stableId)));
	base.selection = structuredClone(canonical.selection);
	for (const field of [
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes', 'videoFreezeFallbacks',
		'videoColorContexts', 'videoSourceColorInterpretations', 'videoVisualPresentations',
		'videoProcessorStacks', 'videoMotionAnalyses', 'videoFinishingPresets',
		'videoCaptionTracks', 'automationLanes', 'mixer',
	]) base[field] = structuredClone(canonical[field]);
	return base;
}

function mergeTracks(baseValue: unknown, canonicalValue: unknown, visualIds: ReadonlySet<string>): DataRecord[] {
	const canonical = new Map(records(canonicalValue, 'finishing tracks').map((track) => [stableId(track), track]));
	return records(baseValue, 'runtime tracks').map((track) => {
		const owner = canonical.get(stableId(track));
		if (!owner) return track;
		if (track.type === 'label' && owner.type === 'label') {
			if (Object.hasOwn(track, 'clipIds') || Object.hasOwn(owner, 'clipIds')) {
				throw new TypeError('finishing runtime label tracks cannot carry clipIds.');
			}
			return track;
		}
		const baseIds = ids(track.clipIds);
		const baseSet = new Set(baseIds);
		const authored = ids(owner.clipIds).filter((id) => baseSet.has(id) || visualIds.has(id));
		const clipIds = [...authored, ...baseIds.filter((id) => !authored.includes(id))];
		return {
			...track,
			clipIds,
			...(owner.type === 'video' ? { videoTransitions: structuredClone(owner.videoTransitions) } : {}),
		};
	});
}

function runtimeClip(project: FramescaperProjectFinishing, clip: DataRecord): DataRecord {
	const kind = clip.kind;
	if (kind !== 'still' && kind !== 'generator') {
		throw new RangeError('Selected finishing visual runtime clips must be stills or generators.');
	}
	const projection = resolveRuntimeClipProjection(
		project as unknown as RuntimeClipProject,
		{
			...clip,
			kind: 'video',
			...(kind === 'still' ? {
				sourceInFrame: 0,
				sourceFrameCount: clip.sequenceFrameCount,
			} : {}),
		},
	) as unknown as DataRecord;
	const source = records(
		(project as unknown as Readonly<DataRecord>).sources, 'finishing visual runtime sources',
	).find(({ id }) => id === clip.sourceId);
	if (!source || typeof source.name !== 'string' || !source.name) {
		throw new ReferenceError('Selected finishing visual runtime clip source name is unavailable.');
	}
	return Object.freeze({ ...projection, kind, title: source.name });
}

function isVisual(value: DataRecord): boolean { return value.kind === 'still' || value.kind === 'generator'; }

function stableId(value: DataRecord): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('finishing runtime identity must be non-empty.');
	return value.id;
}

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('finishing runtime clipIds must be an array.');
	return value.map(String);
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
