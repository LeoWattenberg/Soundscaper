/* SPDX-License-Identifier: AGPL-3.0-only */

import { type FileSizeWarningConfirmation } from '../common/editor/controller/shared/file-size-warning.ts';
import {
	mapFramescaperImageTimelineFrameV1,
	type FramescaperImageClipV1,
} from '../common/editor/timeline-image-model.ts';
import { FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from '../common/editor/timeline-image-frame-pack-v1.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import type { BoundVideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
type ImagePlan = UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV16;
const CHECK = AbortSignal.prototype.throwIfAborted, TIMING_FOR_EACH = Map.prototype.forEach;
import { admitActiveImageAssets, admitImageExecutionResources, type ImageExecutionBaseResourcesTimelineImage, type ImageExecutionResourcesTimelineImage } from './timeline-image-execution-resources-current-v1.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { defaultVideoSourceColorInterpretationV1 } from '../common/editor/video-color-management-v27.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import { createVisibleVideoTrackPredicate } from '../common/editor/video-track-visibility.js';
import {
	framescaperImageSourceForClipTimelineImage,
	framescaperImageDimensionsTimelineImage,
	type FramescaperCurrentImageSourceTimelineImage,
	type FramescaperStoredImageAssetStoreTimelineImage,
} from './editor-selected-timeline-image-image-frame-source.ts';
import { openFramescaperCurrentImageFrameSource, type FramescaperCurrentImageFrameReader } from './timeline-image-current-frame-source.ts';
import { cloneFramescaperProjectTimelineImage, type FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { gradeEncodedFrame } from './selected-finishing-exact-frame-support.ts';
import type { FramescaperSelectedExactSupplementalPictureFinishing } from './selected-finishing-exact-frame-execution.ts';
import type { FramescaperVideoExportSupplementalPictureExecutionFinishing } from './video-export-exact-execution-finishing.ts';

interface ImageContextTimelineImage {
	readonly clip: FramescaperImageClipV1;
	readonly source: FramescaperCurrentImageSourceTimelineImage;
	readonly reader: FramescaperCurrentImageFrameReader;
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
export async function createTimelineImageExecutionCore(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectTimelineImage;
	readonly foundationPlan: ImagePlan;
	readonly store?: FramescaperStoredImageAssetStoreTimelineImage;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
}>, currentMode = false): Promise<FramescaperVideoExportSupplementalPictureExecutionFinishing | null> {
	const project = cloneFramescaperProjectTimelineImage(options?.profile, options?.project);
	assertReady(options, currentMode);
	const visible = visibleImageClips(project, activeSupplementalClipIds(options.foundationPlan));
	if (visible.length === 0) return null;
	if (!options.store) throw new Error('Selected timelineImage image export requires its authenticated asset store.');
	const store = options.foundationPlan.version === 16 ? captureImageStore(options.store) : options.store;
	const planned = visible.map((item) => ({
		...item,
		source: framescaperImageSourceForClipTimelineImage(project.sources, item.clip),
	}));
	const editable = planned.some(({ source }) => source.schemaVersion !== 1);
	if (!currentMode && editable) throw new RangeError('Legacy timeline image execution cannot render an editable image source.');
	await admitActiveImageAssets(planned.map(({ source }) => source), options);
	const baseResources = await admitImageExecutionResources(planned, options);
	const readers = new Map<string, FramescaperCurrentImageFrameReader>();
	const contexts: ImageContextTimelineImage[] = [];
	const frameCache = new Map<string, CachedImageFrameTimelineImage>();
	let readerMetadataBytes = 0n;
	try {
		for (const item of planned) {
			const { source } = item;
			let reader = readers.get(source.id);
			if (!reader) {
				let admittedMetadataBytes: bigint | null = null;
				reader = await openFramescaperCurrentImageFrameSource(
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
			assertReady(options, currentMode);
			contexts.push({ ...item, source, reader });
		}
	} catch (error) {
		await disposeExecutionState(contexts, readers, frameCache, editable);
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
			let capturedSignal: AbortSignal | undefined;
			try {
				if (currentMode) {
					capturedSignal = request.signal;
					Reflect.apply(CHECK, capturedSignal, []);
					request = Object.freeze({ signal: capturedSignal, frame: request.frame,
						width: request.width, height: request.height,
						sequencePosition: Object.freeze({ num: request.sequencePosition.num, den: request.sequencePosition.den }),
					});
					Reflect.apply(CHECK, capturedSignal, []);
				}
				assertReady({ ...options, signal: request.signal }, currentMode);
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
					assertReady({ ...options, signal: request.signal }, currentMode);
					pictures.push(Object.freeze({
						trackId: context.trackId,
						clipId: clip.id,
						sourceId: context.source.id,
						frame,
						displayWidth: framescaperImageDimensionsTimelineImage(context.source).width,
						displayHeight: framescaperImageDimensionsTimelineImage(context.source).height,
						renderDescription: resolveVideoRenderDescription({
							composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
							sourceDisplaySize: {
								width: framescaperImageDimensionsTimelineImage(context.source).width,
								height: framescaperImageDimensionsTimelineImage(context.source).height,
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
				if (capturedSignal) Reflect.apply(CHECK, capturedSignal, []);
				throw error;
			} finally { active = false; }
		},
		dispose() {
			if (disposed) return;
			if (active) throw new Error('The timelineImage image export execution is active.');
			disposed = true;
			return disposeExecutionState(contexts, readers, frameCache, editable);
		},
	});
}

/** Pin the current generation before any admission await. The named V13
 * owner retains its historical options and public signal behavior. */
export function captureCurrentImageExecutionOptionsV16(value: Parameters<typeof createTimelineImageExecutionCore>[0] & Readonly<{ timingSidecars?: UnifiedExactRenderTimingSidecars }>) {
	const signal = value.signal;
	Reflect.apply(CHECK, signal, []);
	try {
		const current = value.assertCurrent;
		if (typeof current !== 'function') throw new TypeError('Current image execution requires its currentness callback.');
		const suppliedTiming = value.timingSidecars;
		const timingSidecars = suppliedTiming === undefined ? undefined : new Map<string, BoundVideoSourceTimingView>();
		if (timingSidecars) Reflect.apply(TIMING_FOR_EACH, suppliedTiming, [
			(token: BoundVideoSourceTimingView, sourceId: string) => { timingSidecars.set(sourceId, token); },
		]);
		const captured = Object.freeze({ signal, profile: value.profile, project: value.project,
			foundationPlan: value.foundationPlan, timingSidecars, store: value.store, confirmFileSizeWarning: value.confirmFileSizeWarning,
			assertCurrent() { Reflect.apply(current, value, []); },
		});
		Reflect.apply(CHECK, signal, []);
		return captured;
	} catch (error) { Reflect.apply(CHECK, signal, []); throw error; }
}

/** Current image execution borrows one pinned method/receiver for every body. */
function captureImageStore(store: FramescaperStoredImageAssetStoreTimelineImage): FramescaperStoredImageAssetStoreTimelineImage {
	let owner: object | null = store;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, 'loadMediaAsset');
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Current image execution requires a captured data reader.');
			const method = descriptor.value as FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset'];
			return Object.freeze({ loadMediaAsset: (...args: Parameters<typeof method>) => Reflect.apply(method, store, args) as ReturnType<typeof method> });
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('Current image execution requires its image body reader.');
}

function admitImageReaderMetadata(
	resources: ImageExecutionBaseResourcesTimelineImage,
	retainedBytes: bigint,
	candidateBytes: bigint,
): void {
	if (executionBaseBytes(resources, retainedBytes + candidateBytes)
		> resources.maximumWorkingBytes) {
		throw new RangeError('timelineImage active image reader metadata exceeds its working byte bound.');
	}
}

function admitResolvedImageFrames(
	resolved: readonly ResolvedImageContextTimelineImage[],
	resources: ImageExecutionResourcesTimelineImage,
	width: number,
	height: number,
): void {
	const frames = new Map<string, FramescaperCurrentImageSourceTimelineImage>();
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
	const maximum = resources.maximumWorkingBytes;
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
			width: framescaperImageDimensionsTimelineImage(context.source).width,
			height: framescaperImageDimensionsTimelineImage(context.source).height,
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
	const tracks = project.tracks.filter(track => track.type === 'video').filter(({ id }) => sequenceTrackIds.has(id));
	const visible = createVisibleVideoTrackPredicate(tracks);
	return Object.freeze(project.clips.flatMap((value) => {
		if (value.kind !== 'image') return [];
		const clip = value as FramescaperImageClipV1;
		if (clip.sequenceId !== sequence.id || !activeClipIds.has(clip.id)) return [];
		const track = tracks.find(({ clipIds }) => clipIds.includes(clip.id));
		if (!track || !visible(track)) return [];
		const trackIndex = sequence.trackIds.indexOf(track.id);
		if (trackIndex < 0) throw new ReferenceError(`timelineImage image track ${track.id} is outside its sequence.`);
		return [{ clip, trackId: track.id, trackIndex }];
	}).sort((left, right) => left.trackIndex - right.trackIndex
		|| left.clip.sequenceStartFrame - right.clip.sequenceStartFrame
		|| compareText(left.clip.id, right.clip.id)));
}

function activeSupplementalClipIds(plan: ImagePlan): ReadonlySet<string> {
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

function assertCanvas(plan: ImagePlan, width: number, height: number): void {
	if (plan.output.canvas.width !== width || plan.output.canvas.height !== height) {
		throw new RangeError('The timelineImage image export canvas changed after planning.');
	}
}

function assertReady(options: Readonly<{
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
}>, currentMode: boolean): void {
	if (currentMode) {
		Reflect.apply(CHECK, options.signal, []);
		try { options.assertCurrent(); }
		catch (error) { Reflect.apply(CHECK, options.signal, []); throw error; }
		Reflect.apply(CHECK, options.signal, []);
		return;
	}
	if (options.signal.aborted) {
		throw options.signal.reason ?? new DOMException('The timelineImage image export was aborted.', 'AbortError');
	}
	options.assertCurrent();
}

function disposeExecutionState(
	contexts: ImageContextTimelineImage[],
	readers: Map<string, FramescaperCurrentImageFrameReader>,
	cache: Map<string, CachedImageFrameTimelineImage>,
	editable: boolean,
): Promise<void> | void {
	disposeFrameCache(cache);
	contexts.length = 0;
	if (!editable) { readers.clear(); return; }
	const closing = [...readers.values()].map(reader => reader.closeAndJoin()); readers.clear();
	return Promise.allSettled(closing).then(results => {
		const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (errors.length) throw new AggregateError(errors, 'Current image frame source cleanup failed.');
	});
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

function decodedFrameBytes(source: FramescaperCurrentImageSourceTimelineImage): bigint {
	const size = framescaperImageDimensionsTimelineImage(source);
	return BigInt(size.width) * BigInt(size.height) * 4n;
}

function executionBaseBytes(
	resources: ImageExecutionBaseResourcesTimelineImage,
	readerMetadataBytes: bigint,
): bigint {
	return resources.snapshotBytes + resources.maximumAssetBytes
		+ rangeReadChunkBytes() + readerMetadataBytes + resources.recipeWorkingBytes;
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
