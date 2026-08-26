/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from '../common/editor/sequence-frame-navigation.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type {
	ProductVideoVisualPreviewCreateRequest,
	ProductVideoVisualPreviewFrame,
	ProductVideoVisualPreviewSession,
	ProductVideoVisualProjectBinThumbnail,
	ProductVideoVisualProjectBinThumbnailRequest,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import {
	fitFramescaperImagePreviewSizeV32,
	framescaperImageSourceForClipV32,
	mapFramescaperImageFrameAtSampleV32,
	openFramescaperStoredImageFramePackV32,
	scaleFramescaperImageRgbaV32,
	throwIfFramescaperImagePreviewAbortedV32,
	type FramescaperImageClipV1,
	type FramescaperImageFramePackReaderV1,
	type FramescaperImageSourceV1,
} from './editor-selected-v32-image-frame-source.ts';
import {
	admitFramescaperImageProjectBinThumbnailResourcesV32,
	admitFramescaperImageTimelinePreviewResourcesV32,
	assertFramescaperImagePreviewReaderMetadataV32,
	FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_V32,
} from './editor-selected-v32-image-preview-resources.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { framescaperProjectV28FoundationShapeV32 } from './editor-project-v32-foundation.ts';
import {
	cloneFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperImagePreviewVideoV32 {
	readonly drawable: unknown;
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly readyState: 4;
	readonly currentTime: 0;
	pause(): void;
}

export interface FramescaperImagePreviewDrawableV32 {
	readonly video: FramescaperImagePreviewVideoV32;
	present(rgba: Uint8Array<ArrayBuffer>): void;
	dispose(): void;
}

export type CreateFramescaperImagePreviewDrawableV32 = (request: Readonly<{
	readonly clipId: string;
	readonly sourceId: string;
	readonly width: number;
	readonly height: number;
}>) => FramescaperImagePreviewDrawableV32;

export type CreateFramescaperInheritedVisualPreviewSessionV32 = (
	request: ProductVideoVisualPreviewCreateRequest,
) => Promise<ProductVideoVisualPreviewSession | null>;

export interface FramescaperSelectedVisualPreviewOptionsV32
	extends ProductVideoVisualPreviewCreateRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly signal?: AbortSignal;
	readonly createImageDrawable?: CreateFramescaperImagePreviewDrawableV32;
	readonly createInheritedSession?: CreateFramescaperInheritedVisualPreviewSessionV32;
	readonly cloneProject?: (profile: unknown, project: unknown) => FramescaperProjectV32;
}

export interface FramescaperSelectedProjectBinThumbnailOptionsV32
	extends ProductVideoVisualProjectBinThumbnailRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly createInheritedThumbnail?: (
		request: ProductVideoVisualProjectBinThumbnailRequest,
	) => Promise<ProductVideoVisualProjectBinThumbnail | null>;
	readonly cloneProject?: (profile: unknown, project: unknown) => FramescaperProjectV32;
}

interface LoadedImageSourceV32 {
	readonly source: FramescaperImageSourceV1;
	readonly reader: FramescaperImageFramePackReaderV1;
	readonly width: number;
	readonly height: number;
	readonly frames: Uint8Array<ArrayBuffer>[];
}

interface PlannedImageSourceV32 {
	readonly source: FramescaperImageSourceV1;
	readonly width: number;
	readonly height: number;
}

interface ImageClipPreviewV32 {
	readonly clip: FramescaperImageClipV1;
	readonly loaded: LoadedImageSourceV32;
	readonly trackId: string;
	readonly trackIndex: number;
	readonly sequenceRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly drawable: FramescaperImagePreviewDrawableV32;
	lastFrameIndex: number;
}

/** Compose authenticated V32 image pictures with the retained V28/V27 preview session. */
export async function createFramescaperSelectedVisualPreviewSessionV32(
	options: FramescaperSelectedVisualPreviewOptionsV32,
): Promise<ProductVideoVisualPreviewSession | null> {
	const project = admittedProject(options?.profile, options?.project, options?.cloneProject);
	const canvas = previewCanvas(options?.width, options?.height);
	throwIfFramescaperImagePreviewAbortedV32(options.signal);
	const contexts = imageClipContexts(project);
	const plannedSources = planTimelineSources(project, contexts, canvas);
	admitFramescaperImageTimelinePreviewResourcesV32(contexts.map(({ clip }) => {
		const planned = required(plannedSources, clip.sourceId, 'planned image source');
		return { source: planned.source, width: planned.width, height: planned.height };
	}));
	const inheritedFactory = options.createInheritedSession ?? ((request) => (
		createDefaultInheritedSession(request, options.store)
	));
	const inheritedPromise = Promise.resolve().then(() => inheritedFactory({ project, ...canvas }));
	const imagePromise = loadTimelineSources(
		options.store, [...plannedSources.values()], options.signal,
	);
	const [inheritedResult, imageResult] = await Promise.allSettled([
		inheritedPromise, imagePromise,
	]);
	if (inheritedResult.status === 'rejected' && imageResult.status === 'rejected') {
		throw new AggregateError(
			[inheritedResult.reason, imageResult.reason],
			'The V32 inherited and image preview routes both failed.',
		);
	}
	if (inheritedResult.status === 'rejected') {
		if (imageResult.status === 'fulfilled') disposeLoadedSources(imageResult.value);
		throw inheritedResult.reason;
	}
	if (imageResult.status === 'rejected') {
		disposeInheritedSession(inheritedResult.value);
		throw imageResult.reason;
	}
	const inherited = inheritedResult.value;
	const loaded = imageResult.value;
	const clips: ImageClipPreviewV32[] = [];
	try {
		throwIfFramescaperImagePreviewAbortedV32(options.signal);
		const bySourceId = new Map(loaded.map((source) => [source.source.id, source]));
		const createDrawable = options.createImageDrawable ?? createCanvasDrawable;
		for (const context of contexts) {
			const source = required(bySourceId, context.clip.sourceId, 'loaded image source');
			const drawable = createDrawable({
				clipId: context.clip.id,
				sourceId: source.source.id,
				width: source.width,
				height: source.height,
			});
			try { assertDrawable(drawable, source.width, source.height); }
			catch (error) { disposeDrawable(drawable); throw error; }
			clips.push({ ...context, loaded: source, drawable, lastFrameIndex: -1 });
		}
	} catch (error) {
		disposeClipDrawables(clips);
		disposeLoadedSources(loaded);
		disposeInheritedSession(inherited);
		throw error;
	}
	if (inherited === null && clips.length === 0) return null;
	let disposed = false;
	const imageFrame = (timelineSampleValue: number): ProductVideoVisualPreviewFrame => {
		if (disposed) throw new Error('The selected V32 image preview session is disposed.');
		return resolveImageFrame(project, clips, timelinePosition(timelineSampleValue), canvas);
	};
	const resolve = (timelineSample: number): ProductVideoVisualPreviewFrame => (
		mergePreviewFrames(inherited?.resolve(timelinePosition(timelineSample)) ?? emptyFrame(), imageFrame(timelineSample))
	);
	// The inherited exact executor owns a flattened V27 graph and cannot place a
	// new V32 image between its already-composited tracks. Keep the exact route
	// only when this session has no image node; image projects retain the layered
	// compositor path until the V32 exact plan owns image nodes itself.
	const renderExact = clips.length === 0 ? inherited?.renderExact : undefined;
	return Object.freeze({
		resolve,
		resolveTransitionWeight(clipId: string, timelineSample: number): number | null {
			if (disposed) throw new Error('The selected V32 image preview session is disposed.');
			return inherited?.resolveTransitionWeight(
				stableId(clipId, 'V32 transition clip ID'), timelinePosition(timelineSample),
			) ?? null;
		},
		...(renderExact ? { async renderExact(request: Readonly<{
			readonly timelineSample: number;
			readonly mediaLayers: readonly unknown[];
		}>) {
			const sample = timelinePosition(request.timelineSample);
			const images = imageFrame(sample);
			const result = await renderExact.call(inherited, {
				timelineSample: sample,
				mediaLayers: request.mediaLayers,
			});
			return Object.freeze({ ...result, frame: mergePreviewFrames(result.frame, images) });
		} } : {}),
		dispose(): void {
			if (disposed) return;
			disposed = true;
			disposeClipDrawables(clips);
			disposeLoadedSources(loaded);
			disposeInheritedSession(inherited);
		},
	});
}

/** Read the Project Bin image's source-start picture through the same authenticated pack. */
export async function createFramescaperSelectedProjectBinThumbnailV32(
	options: FramescaperSelectedProjectBinThumbnailOptionsV32,
): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	const project = admittedProject(options?.profile, options?.project, options?.cloneProject);
	const clipId = stableId(options?.clipId, 'V32 Project Bin image clip ID');
	const clipValue = project.projectBin.clips.find(({ id }) => String(id) === clipId);
	if (!clipValue || clipValue.kind !== 'image') {
		return (options.createInheritedThumbnail ?? ((request) => (
			createDefaultInheritedThumbnail(request, options.store)
		)))({ ...options, project });
	}
	const clip = clipValue as FramescaperImageClipV1;
	const source = framescaperImageSourceForClipV32(project.sources, clip);
	const width = positiveDimension(options.width, 'V32 Project Bin thumbnail width');
	const height = positiveDimension(options.height, 'V32 Project Bin thumbnail height');
	admitFramescaperImageProjectBinThumbnailResourcesV32(source, width, height);
	const reader = await openFramescaperStoredImageFramePackV32(
		options.store, source, options.signal,
		(byteLength) => { assertFramescaperImagePreviewReaderMetadataV32(source, byteLength); },
	);
	const frameIndex = reader.frameIndexAtTicks(BigInt(clip.sourceStartTicks));
	const rgba = await reader.readFrame(frameIndex, options.signal);
	let pixels: Uint8Array<ArrayBuffer>;
	try {
		pixels = scaleFramescaperImageRgbaV32(
			rgba, source.canonical.width, source.canonical.height,
			width, height, options.signal,
		);
	} finally { rgba.fill(0); }
	return Object.freeze({
		clipId,
		sourceId: source.id,
		width,
		height,
		pixels,
		opacity: 1,
		blendMode: 'normal',
		presentationIds: Object.freeze([]),
		maskIds: Object.freeze([]),
	});
}

function imageClipContexts(project: FramescaperProjectV32): readonly Omit<ImageClipPreviewV32,
	'loaded' | 'drawable' | 'lastFrameIndex'>[] {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError('The selected V32 primary sequence is unavailable.');
	const sequenceTrackIds = new Set(sequence.trackIds);
	const videoTracks = project.tracks.filter(({ type, id }) => type === 'video' && sequenceTrackIds.has(id));
	const soloed = videoTracks.some((track) => track.solo === true);
	const visible = new Set(videoTracks.filter((track) => (
		soloed ? track.solo === true : track.hidden !== true
	)).map(({ id }) => id));
	const output: Omit<ImageClipPreviewV32, 'loaded' | 'drawable' | 'lastFrameIndex'>[] = [];
	for (const value of project.clips) {
		if (value.kind !== 'image') continue;
		const clip = value as FramescaperImageClipV1;
		if (clip.sequenceId !== sequence.id) continue;
		const owner = videoTracks.find(({ clipIds }) => clipIds.includes(clip.id));
		if (!owner || !visible.has(owner.id)) continue;
		const trackIndex = sequence.trackIds.indexOf(owner.id);
		if (trackIndex < 0) throw new ReferenceError(`V32 image track ${owner.id} is outside its sequence.`);
		output.push({ clip, trackId: owner.id, trackIndex, sequenceRate: sequence.rate });
		if (output.length > FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_V32) {
			throw new RangeError('V32 image timeline preview exceeds its context count bound.');
		}
	}
	return Object.freeze(output.sort((left, right) => left.trackIndex - right.trackIndex
		|| left.clip.sequenceStartFrame - right.clip.sequenceStartFrame
		|| compareText(left.clip.id, right.clip.id)));
}

function planTimelineSources(
	project: FramescaperProjectV32,
	contexts: readonly Omit<ImageClipPreviewV32, 'loaded' | 'drawable' | 'lastFrameIndex'>[],
	canvas: Readonly<{ width: number; height: number }>,
): ReadonlyMap<string, PlannedImageSourceV32> {
	const output = new Map<string, PlannedImageSourceV32>();
	for (const { clip } of contexts) {
		if (output.has(clip.sourceId)) continue;
		const source = framescaperImageSourceForClipV32(project.sources, clip);
		output.set(source.id, Object.freeze({
			source,
			...fitFramescaperImagePreviewSizeV32(source, canvas.width, canvas.height),
		}));
	}
	return output;
}

async function loadTimelineSources(
	store: AudioEditorProjectStore,
	plannedSources: readonly PlannedImageSourceV32[],
	signal?: AbortSignal,
): Promise<LoadedImageSourceV32[]> {
	const output: LoadedImageSourceV32[] = [];
	try {
		for (const { source, width, height } of [...plannedSources]
			.sort((left, right) => compareText(left.source.id, right.source.id))) {
			const reader = await openFramescaperStoredImageFramePackV32(
				store, source, signal,
				(byteLength) => { assertFramescaperImagePreviewReaderMetadataV32(source, byteLength); },
			);
			const frames: Uint8Array<ArrayBuffer>[] = [];
			try {
				for (let index = 0; index < source.canonical.frameCount; index += 1) {
					const raw = await reader.readFrame(index, signal);
					try {
						frames.push(scaleFramescaperImageRgbaV32(
							raw, source.canonical.width, source.canonical.height,
							width, height, signal,
						));
					} finally { raw.fill(0); }
				}
			} catch (error) {
				for (const frame of frames) frame.fill(0);
				frames.length = 0;
				throw error;
			}
			output.push(Object.freeze({ source, reader, width, height, frames }));
		}
		return output;
	} catch (error) {
		disposeLoadedSources(output);
		throw error;
	}
}

function resolveImageFrame(
	project: FramescaperProjectV32,
	clips: readonly ImageClipPreviewV32[],
	timelineSample: number,
	canvas: Readonly<{ width: number; height: number }>,
): ProductVideoVisualPreviewFrame {
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId)!;
	const sequenceFrame = sequenceFrameAtSample(timelineSample, sequence.rate, project.sampleRate);
	const layers = new Map<string, { trackId: string; trackIndex: number; entries: Data[] }>();
	const nodes: string[] = [];
	for (const context of clips) {
		const clip = context.clip;
		if (sequenceFrame < clip.sequenceStartFrame
			|| sequenceFrame >= clip.sequenceStartFrame + clip.sequenceFrameCount) continue;
		const address = mapFramescaperImageFrameAtSampleV32(
			context.loaded.reader, clip, timelineSample, context.sequenceRate, project.sampleRate,
		);
		if (context.lastFrameIndex !== address.frameIndex) {
			context.drawable.present(context.loaded.frames[address.frameIndex]!);
			context.lastFrameIndex = address.frameIndex;
		}
		const layer = layers.get(context.trackId) ?? {
			trackId: context.trackId, trackIndex: context.trackIndex, entries: [],
		};
		layer.entries.push(imageEntry(context, address, canvas));
		layers.set(context.trackId, layer);
		nodes.push(`render:image:${clip.id}`);
	}
	const ids = uniqueSorted(nodes);
	return Object.freeze({
		layers: Object.freeze([...layers.values()].map((layer) => Object.freeze({
			...layer, entries: Object.freeze(layer.entries),
		}))),
		adjustments: Object.freeze([]),
		activeFreezeNodeIds: Object.freeze([]),
		availablePresetIds: Object.freeze([]),
		ledger: Object.freeze({ requestedNodeIds: ids, consumedNodeIds: ids, omittedNodeIds: Object.freeze([]) }),
	});
}

function imageEntry(
	context: ImageClipPreviewV32,
	address: Readonly<{ sourceTicks: bigint; frameIndex: number }>,
	canvas: Readonly<{ width: number; height: number }>,
): Data {
	const source = context.loaded.source;
	return Object.freeze({
		kind: 'image', role: 'single', clipId: context.clip.id, sourceId: source.id,
		source, clip: context.clip, available: true, video: context.drawable.video,
		effects: Object.freeze([]), opacity: 1,
		displayWidth: source.canonical.width, displayHeight: source.canonical.height,
		renderDescription: resolveVideoRenderDescription({
			composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			sourceDisplaySize: { width: source.canonical.width, height: source.canonical.height },
			canvas,
			opacityStart: 1,
		}),
		imageFrameIndex: address.frameIndex,
		imageSourceTicks: address.sourceTicks.toString(),
	});
}

function mergePreviewFrames(
	left: ProductVideoVisualPreviewFrame,
	right: ProductVideoVisualPreviewFrame,
): ProductVideoVisualPreviewFrame {
	const layers = mergeVisualLayers(left.layers, right.layers);
	return Object.freeze({
		layers,
		adjustments: Object.freeze([...left.adjustments, ...right.adjustments]),
		activeFreezeNodeIds: uniqueSorted([...left.activeFreezeNodeIds, ...right.activeFreezeNodeIds]),
		availablePresetIds: uniqueSorted([...left.availablePresetIds, ...right.availablePresetIds]),
		ledger: Object.freeze({
			requestedNodeIds: uniqueSorted([...left.ledger.requestedNodeIds, ...right.ledger.requestedNodeIds]),
			consumedNodeIds: uniqueSorted([...left.ledger.consumedNodeIds, ...right.ledger.consumedNodeIds]),
			omittedNodeIds: uniqueSorted([...left.ledger.omittedNodeIds, ...right.ledger.omittedNodeIds]),
		}),
	});
}

function mergeVisualLayers(
	left: ProductVideoVisualPreviewFrame['layers'],
	right: ProductVideoVisualPreviewFrame['layers'],
): ProductVideoVisualPreviewFrame['layers'] {
	const output = left.map((layer) => ({ ...layer, entries: [...layer.entries] }));
	for (const layer of right) {
		const existing = output.find(({ trackId }) => trackId === layer.trackId);
		if (!existing) output.push({ ...layer, entries: [...layer.entries] });
		else {
			if (existing.trackIndex !== layer.trackIndex) throw new RangeError('V32 preview track order is ambiguous.');
			existing.entries.push(...layer.entries);
		}
	}
	return Object.freeze(output.map((layer) => Object.freeze({
		...layer, entries: Object.freeze(layer.entries),
	})));
}

function emptyFrame(): ProductVideoVisualPreviewFrame {
	const empty = Object.freeze([]) as readonly string[];
	return Object.freeze({
		layers: Object.freeze([]), adjustments: Object.freeze([]),
		activeFreezeNodeIds: empty, availablePresetIds: empty,
		ledger: Object.freeze({ requestedNodeIds: empty, consumedNodeIds: empty, omittedNodeIds: empty }),
	});
}

async function createDefaultInheritedSession(
	request: ProductVideoVisualPreviewCreateRequest,
	store: AudioEditorProjectStore,
): Promise<ProductVideoVisualPreviewSession | null> {
	const module = await import('./editor-selected-v27-visual-preview.ts');
	return module.createFramescaperSelectedVisualPreviewSessionV27({
		...request,
		project: framescaperProjectV27FoundationShapeV28(
			framescaperProjectV28FoundationShapeV32(request.project),
		),
		profile: FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		store,
	});
}

async function createDefaultInheritedThumbnail(
	request: ProductVideoVisualProjectBinThumbnailRequest,
	store: AudioEditorProjectStore,
): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	const module = await import('./editor-selected-v27-visual-preview.ts');
	return module.createFramescaperSelectedProjectBinThumbnailV27({
		...request,
		project: framescaperProjectV27FoundationShapeV28(
			framescaperProjectV28FoundationShapeV32(request.project),
		),
		profile: FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		store,
	});
}

function createCanvasDrawable(request: Readonly<{
	clipId: string; sourceId: string; width: number; height: number;
}>): FramescaperImagePreviewDrawableV32 {
	if (!globalThis.document?.createElement || typeof globalThis.ImageData !== 'function') {
		throw new Error('Selected V32 image preview requires a browser canvas runtime.');
	}
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = request.width;
	canvas.height = request.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Selected V32 image preview has no 2D canvas context.');
	return Object.freeze({
		video: Object.freeze({
			drawable: canvas, videoWidth: request.width, videoHeight: request.height,
			readyState: 4 as const, currentTime: 0 as const, pause() {},
		}),
		present(rgba: Uint8Array<ArrayBuffer>) {
			context.putImageData(new ImageData(
				new Uint8ClampedArray(rgba), request.width, request.height,
			), 0, 0);
		},
		dispose() {
			context.clearRect(0, 0, request.width, request.height);
			canvas.width = 0;
			canvas.height = 0;
		},
	});
}

function assertDrawable(value: FramescaperImagePreviewDrawableV32, width: number, height: number): void {
	if (!value || typeof value !== 'object' || typeof value.present !== 'function'
		|| typeof value.dispose !== 'function' || !value.video
		|| value.video.videoWidth !== width || value.video.videoHeight !== height) {
		throw new TypeError('A V32 image preview drawable has invalid dimensions or lifecycle ports.');
	}
}

function disposeLoadedSources(sources: LoadedImageSourceV32[]): void {
	for (const source of sources) {
		for (const frame of source.frames) frame.fill(0);
		source.frames.length = 0;
	}
	sources.length = 0;
}

function disposeClipDrawables(clips: ImageClipPreviewV32[]): void {
	for (const clip of clips) disposeDrawable(clip.drawable);
	clips.length = 0;
}

function disposeDrawable(drawable: FramescaperImagePreviewDrawableV32): void {
	try { drawable.dispose(); } catch { /* Continue releasing sibling preview resources. */ }
}

function disposeInheritedSession(session: ProductVideoVisualPreviewSession | null): void {
	try { session?.dispose(); } catch { /* Continue releasing V32 image resources. */ }
}

function admittedProject(
	profile: unknown,
	value: unknown,
	cloneProject: ((profile: unknown, project: unknown) => FramescaperProjectV32) | undefined,
): FramescaperProjectV32 {
	return (cloneProject ?? cloneFramescaperProjectV32)(profile, value);
}

function previewCanvas(width: unknown, height: unknown): Readonly<{ width: number; height: number }> {
	const even = (value: unknown, name: string) => {
		const dimension = positiveDimension(value, name);
		return Math.max(2, dimension - dimension % 2);
	};
	return Object.freeze({ width: even(width, 'V32 preview width'), height: even(height, 'V32 preview height') });
}

function positiveDimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}

function timelinePosition(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('V32 preview sample must be non-negative.');
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return Object.freeze([...new Set(values)].sort(compareText));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function required<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key, name: string): Value {
	const value = map.get(key);
	if (value === undefined) throw new ReferenceError(`V32 ${name} is unavailable.`);
	return value;
}
