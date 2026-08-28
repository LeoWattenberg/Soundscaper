/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import {
	framescaperProjectForCommandConsumersNativeMedia,
	framescaperProjectForEditClipboardConsumersNativeMedia,
	framescaperProjectForRuntimeConsumersNativeMedia,
} from './editor-project-native-media-runtime.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import {
	validateFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';

type DataRecord = Record<string, unknown>;

/** Selected runtime view: inherited resolved timing plus exact timelineImage image authority. */
export function framescaperProjectForRuntimeConsumersTimelineImage(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'runtime');
}

/** Selected command view retains images without changing the inherited command schema. */
export function framescaperProjectForCommandConsumersTimelineImage(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	return projectForConsumers(profile, projectValue, 'command');
}

/** Dedicated common-clipboard view: timelineImage images impersonate video only during descriptor creation. */
export function framescaperProjectForEditClipboardConsumersTimelineImage(
	profile: unknown,
	projectValue: unknown,
): Readonly<DataRecord> {
	validateFramescaperProjectTimelineImage(profile, projectValue);
	const project = projectValue as FramescaperProjectTimelineImage;
	const projected = structuredClone(framescaperProjectForEditClipboardConsumersNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		framescaperProjectNativeMediaFoundationShapeTimelineImage(projectValue),
	)) as DataRecord;
	mergeImageState(projected, project, 'command');
	projected.sources = records(projected.sources, 'timelineImage clipboard sources').map((source) => (
		isImage(source) ? { ...source, kind: 'video' } : source
	));
	projected.clips = records(projected.clips, 'timelineImage clipboard clips').map(imageClipboardClip);
	const bin = record(projected.projectBin, 'timelineImage clipboard Project Bin');
	bin.clips = records(bin.clips, 'timelineImage clipboard Project Bin clips').map(imageClipboardClip);
	return Object.freeze(projected);
}

function projectForConsumers(
	profile: unknown,
	projectValue: unknown,
	kind: 'runtime' | 'command',
): Readonly<DataRecord> {
	validateFramescaperProjectTimelineImage(profile, projectValue);
	const project = projectValue as FramescaperProjectTimelineImage;
	const foundation = framescaperProjectNativeMediaFoundationShapeTimelineImage(project);
	const inherited = kind === 'runtime'
		? framescaperProjectForRuntimeConsumersNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, foundation)
		: framescaperProjectForCommandConsumersNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, foundation);
	const result = mergeImageState(structuredClone(inherited) as DataRecord, project, kind);
	return brandRuntimeProjectProjection(
		Object.freeze(result) as RuntimeClipProject,
	) as Readonly<DataRecord>;
}

function mergeImageState(
	base: DataRecord,
	project: FramescaperProjectTimelineImage,
	kind: 'runtime' | 'command',
): DataRecord {
	const canonical = project as unknown as Readonly<DataRecord>;
	const imageSources = records(canonical.sources, 'timelineImage sources').filter(isImage);
	const imageClips = records(canonical.clips, 'timelineImage clips').filter(isImage);
	const canonicalBin = record(canonical.projectBin, 'timelineImage project bin');
	const imageBinClips = records(canonicalBin.clips, 'timelineImage project bin clips').filter(isImage);
	if (kind === 'runtime') base.schemaVersion =  1;
	base.sources = [...records(base.sources, 'timelineImage inherited sources'), ...structuredClone(imageSources)];
	base.clips = [
		...records(base.clips, 'timelineImage inherited clips'),
		...imageClips.map((clip) => runtimeImageClip(project, clip)),
	];
	const baseBin = record(base.projectBin, 'timelineImage inherited project bin');
	baseBin.clips = [
		...records(baseBin.clips, 'timelineImage inherited project bin clips'),
		...imageBinClips.map((clip) => runtimeImageClip(project, clip)),
	];
	base.tracks = mergeTracks(base.tracks, canonical.tracks, new Set(imageClips.map(stableId)));
	base.selection = structuredClone(canonical.selection);
	base.featureRequirements = structuredClone(canonical.featureRequirements);
	return base;
}

function runtimeImageClip(project: FramescaperProjectTimelineImage, clip: DataRecord): DataRecord {
	const source = records(project.sources, 'timelineImage canonical sources').find(({ id }) => id === clip.sourceId);
	if (!source || source.kind !== 'image' || typeof source.name !== 'string' || !source.name) {
		throw new ReferenceError('A timelineImage runtime image clip requires its exact source.');
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
	const canonical = new Map(records(canonicalValue, 'timelineImage canonical tracks').map((track) => [stableId(track), track]));
	return records(baseValue, 'timelineImage inherited tracks').map((track) => {
		const owner = canonical.get(stableId(track));
		if (!owner) return track;
		if (track.type === 'label' && owner.type === 'label') {
			if (Object.hasOwn(track, 'clipIds') || Object.hasOwn(owner, 'clipIds')) {
				throw new TypeError('timelineImage runtime label tracks cannot carry clipIds.');
			}
			return track;
		}
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
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('timelineImage runtime identity must be non-empty.');
	return value.id;
}

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('timelineImage runtime clipIds must be an array.');
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
