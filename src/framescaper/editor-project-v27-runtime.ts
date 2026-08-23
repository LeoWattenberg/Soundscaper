/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import {
	framescaperProjectForCommandConsumersV20,
	framescaperProjectForRuntimeConsumersV20,
} from './editor-project-v20-runtime.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import { framescaperProjectV20FoundationV22 } from './editor-project-v22-validation.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import { framescaperProjectV22FoundationV24 } from './editor-project-v24-validation.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import {
	framescaperProjectV24FoundationV27,
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';

type DataRecord = Record<string, unknown>;

/** Project selected V27 through the maintained V20 playback engine and retain V24 visuals. */
export function framescaperProjectForRuntimeConsumersV27(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectV27(profile, projectValue);
	const project = projectValue as FramescaperProjectV27;
	const base = framescaperProjectForRuntimeConsumersV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV20FoundationV27(profile, project),
	) as unknown as DataRecord;
	const result = mergeSelectedState(base, project, true);
	return brandRuntimeProjectProjection(Object.freeze(result) as RuntimeClipProject) as Readonly<DataRecord>;
}

/** Authored command view: inherited command helpers see V20 state while V24 visuals remain addressable. */
export function framescaperProjectForCommandConsumersV27(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectV27(profile, projectValue);
	const project = projectValue as FramescaperProjectV27;
	const base = framescaperProjectForCommandConsumersV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV20FoundationV27(profile, project),
	) as unknown as DataRecord;
	return Object.freeze(mergeSelectedState(base, project, false));
}

export function framescaperProjectV20FoundationV27(profile: unknown, project: FramescaperProjectV27) {
	const v24 = framescaperProjectV24FoundationV27(profile, project);
	const v22 = framescaperProjectV22FoundationV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, v24);
	return framescaperProjectV20FoundationV22(FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, v22);
}

function mergeSelectedState(baseValue: DataRecord, project: FramescaperProjectV27, runtime: boolean): DataRecord {
	const base = structuredClone(baseValue) as DataRecord;
	const canonical = project as unknown as Readonly<DataRecord>;
	const visualSources = records(canonical.sources, 'V27 sources').filter(isVisual);
	const visualClips = records(canonical.clips, 'V27 clips').filter(isVisual);
	const canonicalBin = record(canonical.projectBin, 'V27 project bin');
	const visualBin = records(canonicalBin.clips, 'V27 project bin clips').filter(isVisual);
	base.sources = [...records(base.sources, 'runtime sources'), ...structuredClone(visualSources)];
	base.clips = [
		...records(base.clips, 'runtime clips'),
		...visualClips.map((clip) => runtimeClip(project, clip, runtime)),
	];
	const baseBin = record(base.projectBin, 'runtime project bin');
	baseBin.clips = [
		...records(baseBin.clips, 'runtime project bin clips'),
		...visualBin.map((clip) => runtimeClip(project, clip, runtime)),
	];
	base.tracks = mergeTracks(base.tracks, canonical.tracks, new Set(visualClips.map(stableId)));
	for (const field of [
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes', 'videoFreezeFallbacks',
		'videoColorContexts', 'videoSourceColorInterpretations', 'videoVisualPresentations',
		'videoProcessorStacks', 'videoMotionAnalyses', 'videoFinishingPresets',
		'videoCaptionTracks', 'automationLanes', 'mixer',
	]) base[field] = structuredClone(canonical[field]);
	return base;
}

function mergeTracks(baseValue: unknown, canonicalValue: unknown, visualIds: ReadonlySet<string>): DataRecord[] {
	const canonical = new Map(records(canonicalValue, 'V27 tracks').map((track) => [stableId(track), track]));
	return records(baseValue, 'runtime tracks').map((track) => {
		const owner = canonical.get(stableId(track));
		if (!owner) return track;
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

function runtimeClip(project: FramescaperProjectV27, clip: DataRecord, runtime: boolean): DataRecord {
	if (!runtime) return structuredClone(clip);
	const kind = clip.kind;
	if (kind !== 'still' && kind !== 'generator') {
		throw new RangeError('Selected V27 visual runtime clips must be stills or generators.');
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
	return Object.freeze({ ...projection, kind });
}

function isVisual(value: DataRecord): boolean { return value.kind === 'still' || value.kind === 'generator'; }

function stableId(value: DataRecord): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('V27 runtime identity must be non-empty.');
	return value.id;
}

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('V27 runtime clipIds must be an array.');
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
