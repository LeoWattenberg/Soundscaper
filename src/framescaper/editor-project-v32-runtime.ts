/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import {
	framescaperProjectForCommandConsumersV28,
	framescaperProjectForEditClipboardConsumersV28,
	framescaperProjectForRuntimeConsumersV28,
} from './editor-project-v28-runtime.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV28FoundationShapeV32 } from './editor-project-v32-foundation.ts';
import {
	validateFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';

type DataRecord = Record<string, unknown>;

/** Selected runtime view: inherited resolved timing plus exact V32 image authority. */
export function framescaperProjectForRuntimeConsumersV32(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'runtime');
}

/** Selected command view retains images without changing the inherited command schema. */
export function framescaperProjectForCommandConsumersV32(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'command');
}

/** Dedicated common-clipboard view: V32 images impersonate video only during descriptor creation. */
export function framescaperProjectForEditClipboardConsumersV32(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectV32(profile, projectValue);
	const project = projectValue as FramescaperProjectV32;
	const projected = structuredClone(framescaperProjectForEditClipboardConsumersV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV32(projectValue),
	)) as DataRecord;
	mergeImageState(projected, project, 'command');
	projected.sources = records(projected.sources, 'V32 clipboard sources').map((source) => (
		isImage(source) ? { ...source, kind: 'video' } : source
	));
	projected.clips = records(projected.clips, 'V32 clipboard clips').map(imageClipboardClip);
	const bin = record(projected.projectBin, 'V32 clipboard Project Bin');
	bin.clips = records(bin.clips, 'V32 clipboard Project Bin clips').map(imageClipboardClip);
	return Object.freeze(projected);
}

function projectForConsumers(
	profile: unknown,
	projectValue: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	validateFramescaperProjectV32(profile, projectValue);
	const project = projectValue as FramescaperProjectV32;
	const foundation = framescaperProjectV28FoundationShapeV32(project);
	const inherited = kind === 'runtime'
		? framescaperProjectForRuntimeConsumersV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, foundation)
		: framescaperProjectForCommandConsumersV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, foundation);
	const result = mergeImageState(structuredClone(inherited) as DataRecord, project, kind);
	return brandRuntimeProjectProjection(
		Object.freeze(result) as RuntimeClipProject,
	) as Readonly<DataRecord>;
}

function mergeImageState(
	base: DataRecord,
	project: FramescaperProjectV32,
	kind: 'runtime' | 'command',
): DataRecord {
	const canonical = project as unknown as Readonly<DataRecord>;
	const imageSources = records(canonical.sources, 'V32 sources').filter(isImage);
	const imageClips = records(canonical.clips, 'V32 clips').filter(isImage);
	const canonicalBin = record(canonical.projectBin, 'V32 project bin');
	const imageBinClips = records(canonicalBin.clips, 'V32 project bin clips').filter(isImage);
	if (kind === 'runtime') base.schemaVersion = 32;
	base.sources = [...records(base.sources, 'V32 inherited sources'), ...structuredClone(imageSources)];
	base.clips = [
		...records(base.clips, 'V32 inherited clips'),
		...imageClips.map((clip) => runtimeImageClip(project, clip)),
	];
	const baseBin = record(base.projectBin, 'V32 inherited project bin');
	baseBin.clips = [
		...records(baseBin.clips, 'V32 inherited project bin clips'),
		...imageBinClips.map((clip) => runtimeImageClip(project, clip)),
	];
	base.tracks = mergeTracks(base.tracks, canonical.tracks, new Set(imageClips.map(stableId)));
	base.selection = structuredClone(canonical.selection);
	base.featureRequirements = structuredClone(canonical.featureRequirements);
	return base;
}

function runtimeImageClip(project: FramescaperProjectV32, clip: DataRecord): DataRecord {
	const source = records(project.sources, 'V32 canonical sources').find(({ id }) => id === clip.sourceId);
	if (!source || source.kind !== 'image' || typeof source.name !== 'string' || !source.name) {
		throw new ReferenceError('A V32 runtime image clip requires its exact source.');
	}
	const projection = resolveRuntimeClipProjection(
		project as unknown as RuntimeClipProject,
		{
			...clip,
			kind: 'video',
			sourceInFrame: 0,
			sourceFrameCount: clip.sequenceFrameCount,
		},
	) as unknown as DataRecord;
	return Object.freeze({
		...projection,
		kind: 'image',
		title: source.name,
		sourceStartTicks: clip.sourceStartTicks,
	});
}

function imageClipboardClip(clip: DataRecord): DataRecord {
	if (!isImage(clip)) return clip;
	return {
		...clip,
		kind: 'video',
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
	};
}

function mergeTracks(
	baseValue: unknown,
	canonicalValue: unknown,
	imageIds: ReadonlySet<string>,
): DataRecord[] {
	const canonical = new Map(records(canonicalValue, 'V32 canonical tracks').map((track) => [stableId(track), track]));
	return records(baseValue, 'V32 inherited tracks').map((track) => {
		const owner = canonical.get(stableId(track));
		if (!owner) return track;
		const baseIds = ids(track.clipIds);
		const baseSet = new Set(baseIds);
		const authored = ids(owner.clipIds).filter((id) => baseSet.has(id) || imageIds.has(id));
		return {
			...track,
			clipIds: [...authored, ...baseIds.filter((id) => !authored.includes(id))],
		};
	});
}

function isImage(value: DataRecord): boolean { return value.kind === 'image'; }

function stableId(value: DataRecord): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('V32 runtime identity must be non-empty.');
	return value.id;
}

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('V32 runtime clipIds must be an array.');
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
