/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mapFramescaperImageTimelineFrameV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from '../common/editor/timeline-image-frame-pack-v1.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { defaultVideoSourceColorInterpretationV1 } from '../common/editor/video-color-management-v27.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import {
	framescaperImageSourceForClipTimelineImage,
	openFramescaperStoredImageFramePackTimelineImage,
	type FramescaperImageFramePackReaderV1,
	type FramescaperStoredImageAssetStoreTimelineImage,
} from './editor-selected-timeline-image-image-frame-source.ts';
import { cloneFramescaperProjectTimelineImage, type FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { gradeEncodedFrame } from './selected-finishing-exact-frame-support.ts';
import type { FramescaperSelectedExactSupplementalPictureFinishing } from './selected-finishing-exact-frame-execution.ts';
import type { FramescaperVideoExportSupplementalPictureExecutionFinishing } from './video-export-exact-execution-finishing.ts';

interface ImageContextTimelineImage {
	readonly clip: FramescaperImageClipV1;
	readonly source: FramescaperImageSourceV1;
	readonly reader: FramescaperImageFramePackReaderV1;
	readonly trackId: string;
	readonly trackIndex: number;
}

type LinearImageFrameTimelineImage = Readonly<{
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}>;

interface CachedImageFrameTimelineImage {
	readonly sourceId: string;
	readonly frameIndex: number;
	readonly frame: LinearImageFrameTimelineImage;
}

interface ResolvedImageContextTimelineImage {
	readonly context: ImageContextTimelineImage;
	readonly frameIndex: number;
}

/** Resolve authenticated timelineImage frame packs directly into the exact linear compositor. */
export async function createFramescaperVideoExportImageExecutionTimelineImage(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectTimelineImage;
	readonly foundationPlan: UnifiedExactRenderPlanV13;
	readonly store?: FramescaperStoredImageAssetStoreTimelineImage;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}>): Promise<FramescaperVideoExportSupplementalPictureExecutionFinishing | null> {
	const project = cloneFramescaperProjectTimelineImage(options?.profile, options?.project);
	assertReady(options);
	const visible = visibleImageClips(project, activeSupplementalClipIds(options.foundationPlan));
	if (visible.length === 0) return null;
	if (!options.store) throw new Error('Selected timelineImage image export requires its authenticated asset store.');
	const store = options.store;
	const planned = visible.map((item) => ({
		...item,
		source: framescaperImageSourceForClipTimelineImage(project.sources, item.clip),
	}));
	admitActiveImageAssets(planned.map(({ source }) => source));
	const baseResources = admitImageExecutionResources(planned);
	const readers = new Map<string, FramescaperImageFramePackReaderV1>();
	const contexts: ImageContextTimelineImage[] = [];
	const frameCache = new Map<string, CachedImageFrameTimelineImage>();
	let readerMetadataBytes = 0n;
	try {
		for (const item of planned) {
			const { source } = item;
			let reader = readers.get(source.id);
			if (!reader) {
				let admittedMetadataBytes: bigint | null = null;
				reader = await openFramescaperStoredImageFramePackTimelineImage(
					store, source, options.signal, (byteLength) => {
						admittedMetadataBytes = BigInt(byteLength);
						admitImageReaderMetadata(
							baseResources, readerMetadataBytes, admittedMetadataBytes,
						);
					},
				);
				if (admittedMetadataBytes === null
					|| BigInt(reader.residentMetadataByteEstimate) !== admittedMetadataBytes) {
					throw new Error('timelineImage image reader changed its admitted metadata byte estimate.');
				}
				readerMetadataBytes += admittedMetadataBytes;
				readers.set(source.id, reader);
			}
			assertReady(options);
			contexts.push({ ...item, source, reader });
		}
	} catch (error) {
		disposeExecutionState(contexts, readers, frameCache);
		throw error;
	}
	const resources = Object.freeze({ ...baseResources, readerMetadataBytes });
	let disposed = false;
	let active = false;
	return Object.freeze({
		async resolve(request: Parameters<FramescaperVideoExportSupplementalPictureExecutionFinishing['resolve']>[0]) {
			if (disposed) throw new Error('The timelineImage image export execution is disposed.');
			if (active) throw new Error('The timelineImage image export execution cannot overlap frames.');
			active = true;
			try {
				assertReady({ ...options, signal: request.signal });
				assertCanvas(options.foundationPlan, request.width, request.height);
				const sequenceFrame = floorRational(request.sequencePosition);
				const resolved = resolvedImageContexts(contexts, project, sequenceFrame);
				admitResolvedImageFrames(resolved, resources, request.width, request.height);
				retainCachedFrames(frameCache, new Set(resolved.map(({ context, frameIndex }) => (
					imageFrameKey(context.source.id, frameIndex)
				))));
				const pictures: FramescaperSelectedExactSupplementalPictureFinishing[] = [];
				for (const { context, frameIndex } of resolved) {
					const clip = context.clip;
					const frame = await linearFrame(context, frameIndex, frameCache, request.signal);
					assertReady({ ...options, signal: request.signal });
					pictures.push(Object.freeze({
						trackId: context.trackId,
						clipId: clip.id,
						sourceId: context.source.id,
						frame,
						displayWidth: context.source.canonical.width,
						displayHeight: context.source.canonical.height,
						renderDescription: resolveVideoRenderDescription({
							composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
							sourceDisplaySize: {
								width: context.source.canonical.width,
								height: context.source.canonical.height,
							},
							canvas: {
								width: request.width,
								height: request.height,
								fit: options.foundationPlan.output.canvas.fit,
							},
							opacityStart: 1,
						}),
						opacity: 1,
					}));
				}
				return Object.freeze(pictures);
			} catch (error) {
				disposeFrameCache(frameCache);
				throw error;
			} finally { active = false; }
		},
		dispose() {
			if (disposed) return;
			if (active) throw new Error('The timelineImage image export execution is active.');
			disposed = true;
			disposeExecutionState(contexts, readers, frameCache);
		},
	});
}

const MAXIMUM_ACTIVE_IMAGE_ASSETS = 512;
const MAXIMUM_ACTIVE_IMAGE_ASSET_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ACTIVE_IMAGE_CONTEXTS = 4_096;
const MAXIMUM_IMAGE_EXECUTION_WORKING_BYTES = 512 * 1024 * 1024;

interface ImageExecutionResourcesTimelineImage {
	readonly maximumAssetBytes: bigint;
	readonly snapshotBytes: bigint;
	readonly readerMetadataBytes: bigint;
}

type ImageExecutionBaseResourcesTimelineImage = Omit<ImageExecutionResourcesTimelineImage, 'readerMetadataBytes'>;

function admitActiveImageAssets(sources: readonly FramescaperImageSourceV1[]): void {
	const unique = new Map(sources.map((source) => [source.id, source] as const));
	if (unique.size > MAXIMUM_ACTIVE_IMAGE_ASSETS) {
		throw new RangeError('timelineImage active image assets exceed their count bound.');
	}
	let total = 0n;
	for (const source of unique.values()) total += BigInt(source.assetByteLength);
	if (total > BigInt(MAXIMUM_ACTIVE_IMAGE_ASSET_BYTES)) {
		throw new RangeError('timelineImage active image assets exceed their byte bound.');
	}
}

function admitImageExecutionResources(
	planned: readonly Readonly<{
		readonly clip: FramescaperImageClipV1;
		readonly source: FramescaperImageSourceV1;
	}>[],
): ImageExecutionBaseResourcesTimelineImage {
	if (planned.length > MAXIMUM_ACTIVE_IMAGE_CONTEXTS) {
		throw new RangeError('timelineImage active image clips exceed their context bound.');
	}
	const sources = new Map<string, FramescaperImageSourceV1>();
	for (const { source } of planned) sources.set(source.id, source);
	let snapshotBytes = 0n;
	let maximumAssetBytes = 0n;
	for (const source of sources.values()) {
		const assetBytes = BigInt(source.assetByteLength);
		snapshotBytes += assetBytes;
		maximumAssetBytes = maximumBigInt(maximumAssetBytes, assetBytes);
	}
	const maximum = BigInt(MAXIMUM_IMAGE_EXECUTION_WORKING_BYTES);
	if (snapshotBytes + maximumAssetBytes + rangeReadChunkBytes() > maximum) {
		throw new RangeError('timelineImage active image snapshots exceed their working byte bound.');
	}
	return Object.freeze({ maximumAssetBytes, snapshotBytes });
}

function admitImageReaderMetadata(
	resources: ImageExecutionBaseResourcesTimelineImage,
	retainedBytes: bigint,
	candidateBytes: bigint,
): void {
	if (executionBaseBytes(resources, retainedBytes + candidateBytes)
		> BigInt(MAXIMUM_IMAGE_EXECUTION_WORKING_BYTES)) {
		throw new RangeError('timelineImage active image reader metadata exceeds its working byte bound.');
	}
}

function admitResolvedImageFrames(
	resolved: readonly ResolvedImageContextTimelineImage[],
	resources: ImageExecutionResourcesTimelineImage,
	width: number,
	height: number,
): void {
	const frames = new Map<string, FramescaperImageSourceV1>();
	for (const { context, frameIndex } of resolved) {
		frames.set(imageFrameKey(context.source.id, frameIndex), context.source);
	}
	let decodedCacheBytes = 0n;
	let maximumDecodedFrameBytes = 0n;
	for (const source of frames.values()) {
		const frameBytes = decodedFrameBytes(source);
		decodedCacheBytes += frameBytes;
		maximumDecodedFrameBytes = maximumBigInt(maximumDecodedFrameBytes, frameBytes);
	}
	const decodedWorkingBytes = executionBaseBytes(resources, resources.readerMetadataBytes)
		+ decodedCacheBytes + maximumDecodedFrameBytes;
	const maximum = BigInt(MAXIMUM_IMAGE_EXECUTION_WORKING_BYTES);
	if (decodedWorkingBytes > maximum) {
		throw new RangeError('timelineImage resolved image frames exceed their decoded working byte bound.');
	}
	const canvasPixels = BigInt(width) * BigInt(height);
	const canvasWorkingBytes = resolved.length === 0 ? 0n
		: BigInt(resolved.length) * canvasPixels * 4n * 8n
			+ canvasPixels * 4n
			+ canvasPixels * 4n * 8n;
	if (decodedWorkingBytes + canvasWorkingBytes > maximum) {
		throw new RangeError('timelineImage resolved image frames exceed their compositing working byte bound.');
	}
}

async function linearFrame(
	context: ImageContextTimelineImage,
	frameIndex: number,
	cache: Map<string, CachedImageFrameTimelineImage>,
	signal: AbortSignal,
): Promise<LinearImageFrameTimelineImage> {
	const key = imageFrameKey(context.source.id, frameIndex);
	const cached = cache.get(key);
	if (cached) return cached.frame;
	const sourcePixels = await context.reader.readFrame(frameIndex, signal);
	let linear: LinearImageFrameTimelineImage;
	try {
		linear = gradeEncodedFrame({
			width: context.source.canonical.width,
			height: context.source.canonical.height,
			pixels: sourcePixels as Uint8Array<ArrayBuffer>,
		}, defaultVideoSourceColorInterpretationV1('still', context.source.id), [], new Map(), signal);
	} finally { sourcePixels.fill(0); }
	cache.set(key, Object.freeze({ sourceId: context.source.id, frameIndex, frame: linear }));
	return linear;
}

function resolvedImageContexts(
	contexts: readonly ImageContextTimelineImage[],
	project: FramescaperProjectTimelineImage,
	sequenceFrame: number,
): readonly ResolvedImageContextTimelineImage[] {
	return Object.freeze(contexts.flatMap((context) => {
		const { clip } = context;
		if (sequenceFrame < clip.sequenceStartFrame
			|| sequenceFrame >= clip.sequenceStartFrame + clip.sequenceFrameCount) return [];
		const address = mapFramescaperImageTimelineFrameV1({
			clip,
			sequenceFrame,
			sequenceRate: sequenceRate(project, clip.sequenceId),
			timings: context.reader.timings,
		});
		return [{ context, frameIndex: address.frameIndex }];
	}));
}

function visibleImageClips(
	project: FramescaperProjectTimelineImage,
	activeClipIds: ReadonlySet<string>,
): readonly Readonly<{
	readonly clip: FramescaperImageClipV1;
	readonly trackId: string;
	readonly trackIndex: number;
}>[] {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError('The timelineImage image export primary sequence is unavailable.');
	const sequenceTrackIds = new Set(sequence.trackIds);
	const tracks = project.tracks.filter(({ id, type }) => type === 'video' && sequenceTrackIds.has(id));
	const soloed = tracks.some(({ solo }) => solo === true);
	const visibleTrackIds = new Set(tracks.filter((track) => (
		soloed ? track.solo === true : track.hidden !== true
	)).map(({ id }) => id));
	return Object.freeze(project.clips.flatMap((value) => {
		if (value.kind !== 'image') return [];
		const clip = value as FramescaperImageClipV1;
		if (clip.sequenceId !== sequence.id || !activeClipIds.has(clip.id)) return [];
		const track = tracks.find(({ clipIds }) => clipIds.includes(clip.id));
		if (!track || !visibleTrackIds.has(track.id)) return [];
		const trackIndex = sequence.trackIds.indexOf(track.id);
		if (trackIndex < 0) throw new ReferenceError(`timelineImage image track ${track.id} is outside its sequence.`);
		return [{ clip, trackId: track.id, trackIndex }];
	}).sort((left, right) => left.trackIndex - right.trackIndex
		|| left.clip.sequenceStartFrame - right.clip.sequenceStartFrame
		|| compareText(left.clip.id, right.clip.id)));
}

function activeSupplementalClipIds(plan: UnifiedExactRenderPlanV13): ReadonlySet<string> {
	return new Set(plan.nodes.flatMap((node) => {
		if (node.kind !== 'visual' || node.placement === null
			|| !('source' in node.authoredState)
			|| node.authoredState.source.kind !== 'generator') return [];
		return [node.modelId];
	}));
}

function sequenceRate(project: FramescaperProjectTimelineImage, sequenceId: string) {
	const sequence = project.sequences.find(({ id }) => id === sequenceId);
	if (!sequence) throw new ReferenceError(`timelineImage image sequence ${sequenceId} is unavailable.`);
	return sequence.rate;
}

function floorRational(value: Readonly<{ readonly num: number; readonly den: number }>): number {
	if (!Number.isSafeInteger(value?.num) || !Number.isSafeInteger(value?.den) || value.den < 1 || value.num < 0) {
		throw new RangeError('The timelineImage image export sequence position is invalid.');
	}
	const result = Number(BigInt(value.num) / BigInt(value.den));
	if (!Number.isSafeInteger(result)) throw new RangeError('The timelineImage image export sequence frame exceeds its domain.');
	return result;
}

function assertCanvas(plan: UnifiedExactRenderPlanV13, width: number, height: number): void {
	if (plan.output.canvas.width !== width || plan.output.canvas.height !== height) {
		throw new RangeError('The timelineImage image export canvas changed after planning.');
	}
}

function assertReady(options: Readonly<{
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}>): void {
	if (options.signal.aborted) {
		throw options.signal.reason ?? new DOMException('The timelineImage image export was aborted.', 'AbortError');
	}
	options.assertCurrent();
}

function disposeExecutionState(
	contexts: ImageContextTimelineImage[],
	readers: Map<string, FramescaperImageFramePackReaderV1>,
	cache: Map<string, CachedImageFrameTimelineImage>,
): void {
	disposeFrameCache(cache);
	contexts.length = 0;
	readers.clear();
}

function retainCachedFrames(
	cache: Map<string, CachedImageFrameTimelineImage>,
	keys: ReadonlySet<string>,
): void {
	for (const [key, cached] of cache) {
		if (keys.has(key)) continue;
		cached.frame.pixels.fill(0);
		cache.delete(key);
	}
}

function disposeFrameCache(cache: Map<string, CachedImageFrameTimelineImage>): void {
	for (const cached of cache.values()) cached.frame.pixels.fill(0);
	cache.clear();
}

function decodedFrameBytes(source: FramescaperImageSourceV1): bigint {
	return BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n;
}

function executionBaseBytes(
	resources: ImageExecutionBaseResourcesTimelineImage,
	readerMetadataBytes: bigint,
): bigint {
	return resources.snapshotBytes + resources.maximumAssetBytes
		+ rangeReadChunkBytes() + readerMetadataBytes;
}

function rangeReadChunkBytes(): bigint {
	return BigInt(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES);
}

function imageFrameKey(sourceId: string, frameIndex: number): string {
	return `${sourceId}\0${String(frameIndex)}`;
}

function maximumBigInt(left: bigint, right: bigint): bigint {
	return left > right ? left : right;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
