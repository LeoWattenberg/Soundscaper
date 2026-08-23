/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertVideoKeyframeExportFrame,
	assertVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from '../video-keyframe-export-frame-source.ts';
import { VideoPreviewCompositor } from './video-preview-compositor.js';
import {
	planVideoKeyframeOfflineRgba,
} from './video-keyframe-offline-rgba-admission.ts';
import {
	VIDEO_KEYFRAME_OFFLINE_MAXIMUM_PINNED_OCCURRENCES,
	VideoKeyframeOfflineSourceCache,
	type VideoKeyframeOfflineSourceResolver,
} from './video-keyframe-offline-rgba-source.ts';

interface OfflineCanvas extends HTMLCanvasElement {
	readonly width: number;
	readonly height: number;
}

interface OfflineVideoPreviewCompositor {
	readonly gl: WebGL2RenderingContext;
	render(
		layers: Readonly<Record<string, unknown>>[],
		options: Readonly<Record<string, unknown>>,
	): Readonly<{
		readonly status: 'rendered' | 'fallback';
		readonly rendererStatus: 'available' | 'failed';
		readonly renderedEntryCount: number;
	}>;
	dispose(): void;
}

export interface VideoKeyframeOfflineRgbaRendererOptions {
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly canvas: OfflineCanvas;
	readonly resolveSource: VideoKeyframeOfflineSourceResolver;
	readonly createCompositor?: (canvas: OfflineCanvas) => OfflineVideoPreviewCompositor;
	readonly compose?: VideoKeyframeOfflineRgbaCompositor;
	readonly postprocess?: VideoKeyframeOfflineRgbaPostprocessor;
}

export type VideoKeyframeOfflineRgbaCompositor = (request: Readonly<{
	readonly frame: VideoKeyframeExportFrame;
	readonly layers: readonly Readonly<Record<string, unknown>>[];
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array<ArrayBuffer>;
	readonly signal: AbortSignal;
}>) => PromiseLike<void> | void;

export type VideoKeyframeOfflineRgbaPostprocessor = (request: Readonly<{
	readonly frame: VideoKeyframeExportFrame;
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array<ArrayBuffer>;
	readonly signal: AbortSignal;
}>) => PromiseLike<void> | void;

interface NormalizedVideoKeyframeOfflineRgbaRendererOptions {
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly canvas: OfflineCanvas;
	readonly resolveSource: VideoKeyframeOfflineSourceResolver;
	readonly createCompositor: (canvas: OfflineCanvas) => OfflineVideoPreviewCompositor;
	readonly compose?: VideoKeyframeOfflineRgbaCompositor;
	readonly postprocess?: VideoKeyframeOfflineRgbaPostprocessor;
}

interface OfflineLayerSnapshot {
	readonly layer: Readonly<Record<string, unknown>>;
	readonly entries: readonly Readonly<Record<string, unknown>>[];
}

export interface VideoKeyframeOfflineRgbaRenderer {
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
	produce(
		frame: VideoKeyframeExportFrame,
		reusable: Uint8Array,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): Promise<void>;
	dispose(): Promise<void>;
}

/** Render one exact branded frame at a time into a caller-owned reusable RGBA buffer. */
export function createVideoKeyframeOfflineRgbaRenderer(
	optionsValue: VideoKeyframeOfflineRgbaRendererOptions,
): VideoKeyframeOfflineRgbaRenderer {
	const options = snapshotOptions(optionsValue);
	const frameSource = options.frameSource;
	assertVideoKeyframeExportFrameSource(frameSource);
	const plan = planVideoKeyframeOfflineRgba(frameSource.canvas);
	const canvas = options.canvas;
	const sourceCache = new VideoKeyframeOfflineSourceCache(options.resolveSource);
	let compositor: OfflineVideoPreviewCompositor;
	try {
		compositor = options.createCompositor(canvas);
	} catch (error) {
		void sourceCache.dispose().catch(() => undefined);
		throw error;
	}
	const gl = compositor.gl;
	const rowScratch = new Uint8Array(plan.width * 4);
	let active = false;
	let disposed = false;
	let disposePromise: Promise<void> | null = null;

	async function produce(
		frame: VideoKeyframeExportFrame,
		reusable: Uint8Array,
		produceOptions: Readonly<{ readonly signal: AbortSignal }>,
	): Promise<void> {
		if (disposed) throw new Error('The offline video RGBA renderer is closed.');
		if (active) throw new Error('The offline video RGBA renderer cannot overlap frames.');
		active = true;
		let outputAccepted = false;
		try {
			assertVideoKeyframeExportFrame(frameSource, frame);
			const signal = requiredAbortSignal(produceOptions);
			throwIfAborted(signal);
			assertReusableBuffer(reusable, plan.byteLength);
			outputAccepted = true;
			reusable.fill(0);
			const snapshots = snapshotDrawableLayers(frame.layers);
			sourceCache.beginFrame();
			try {
				const layers = await resolveDrawableLayers(snapshots, sourceCache, signal);
				throwIfAborted(signal);
				if (options.compose) await options.compose(Object.freeze({
					frame, layers, width: plan.width, height: plan.height,
					rgba: reusable as Uint8Array<ArrayBuffer>, signal,
				}));
				else {
					const report = compositor.render([...layers], {
					referenceWidth: plan.width,
					referenceHeight: plan.height,
					outputWidth: plan.width,
					outputHeight: plan.height,
					outputColorModel: 'rgba',
					// The delivery's own background, which the canvas states and the
					// composed-graph path paints into its letterbox bars.
					backgroundColor: frameSource.canvas.backgroundColor,
					});
					if (report.status !== 'rendered'
						|| report.rendererStatus !== 'available'
						|| report.renderedEntryCount !== entryCount(layers)) {
						throw new Error('The offline video compositor omitted requested frame content.');
					}
					throwIfAborted(signal);
					assertGlReady(gl);
					gl.readPixels(0, 0, plan.width, plan.height, gl.RGBA, gl.UNSIGNED_BYTE, reusable);
					assertGlReady(gl);
					flipRowsInPlace(reusable, rowScratch, plan.height);
				}
				throwIfAborted(signal);
				await options.postprocess?.(Object.freeze({
					frame, width: plan.width, height: plan.height,
					rgba: reusable as Uint8Array<ArrayBuffer>, signal,
				}));
				throwIfAborted(signal);
			} finally {
				sourceCache.finishFrame();
			}
		} catch (error) {
			if (outputAccepted) reusable.fill(0);
			throw error;
		} finally {
			rowScratch.fill(0);
			active = false;
		}
	}

	function dispose(): Promise<void> {
		if (disposePromise !== null) return disposePromise;
		if (active) return Promise.reject(new Error('The offline video RGBA renderer is rendering a frame.'));
		disposed = true;
		const operation = (async () => {
			const failures: unknown[] = [];
			try { compositor.dispose(); } catch (error) { failures.push(error); }
			try { await sourceCache.dispose(); } catch (error) { failures.push(error); }
			rowScratch.fill(0);
			if (failures.length > 0) {
				throw new AggregateError(failures, 'Offline video RGBA renderer cleanup failed.');
			}
		})();
		disposePromise = operation.catch((error: unknown) => {
			disposePromise = null;
			throw error;
		});
		return disposePromise;
	}

	return Object.freeze({
		width: plan.width,
		height: plan.height,
		byteLength: plan.byteLength,
		produce,
		dispose,
	});
}

async function resolveDrawableLayers(
	snapshots: readonly OfflineLayerSnapshot[],
	cache: VideoKeyframeOfflineSourceCache,
	signal: AbortSignal,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	const layers: Readonly<Record<string, unknown>>[] = [];
	for (const { layer, entries: entrySnapshots } of snapshots) {
		const entries: Readonly<Record<string, unknown>>[] = [];
		for (const entry of entrySnapshots) {
			throwIfAborted(signal);
			const video = await cache.present(entry, signal);
			const targetEntry = {
				...entry,
				video,
				effects: entry.videoEffects
					?? (entry.clip as Readonly<Record<string, unknown>> | undefined)?.videoEffects
					?? Object.freeze([]),
				opacity: entry.opacity,
				displayWidth: video.displayWidth,
				displayHeight: video.displayHeight,
				...(entry.renderDescription == null ? {} : {
					renderDescription: entry.renderDescription,
					intervalProgress: 0,
				}),
			};
			entries.push(Object.freeze(targetEntry));
		}
		layers.push(Object.freeze({
			trackId: layer.trackId,
			...(layer.trackIndex === undefined ? {} : { trackIndex: layer.trackIndex }),
			entries: Object.freeze(entries),
			...(entries[0]?.renderDescription == null ? {} : {
				blendMode: (entries[0].renderDescription as Readonly<Record<string, unknown>>).blendMode,
			}),
		}));
	}
	return Object.freeze(layers);
}

function snapshotDrawableLayers(layersValue: readonly unknown[]): readonly OfflineLayerSnapshot[] {
	if (!Array.isArray(layersValue)) throw new TypeError('An offline video frame requires layers.');
	const occurrences = new Set<string>();
	const snapshots: OfflineLayerSnapshot[] = [];
	for (const layerValue of layersValue) {
		const layer = record(layerValue, 'offline video layer');
		const clips = data(layer, 'clips', 'offline video layer');
		if (!Array.isArray(clips)) throw new TypeError('An offline video layer requires clip entries.');
		const entries: Readonly<Record<string, unknown>>[] = [];
		for (const entryValue of clips) {
			const entry = record(entryValue, 'offline video layer entry');
			const sourceId = boundedEntryId(entry, 'sourceId');
			const clipId = boundedEntryId(entry, 'clipId');
			const occurrence = `${String(clipId.length)}:${clipId}${sourceId}`;
			if (occurrences.has(occurrence)) {
				throw new Error('An offline video frame contains a duplicate source occurrence.');
			}
			occurrences.add(occurrence);
			if (occurrences.size > VIDEO_KEYFRAME_OFFLINE_MAXIMUM_PINNED_OCCURRENCES) {
				throw new RangeError('An offline video frame exceeds its source occurrence limit.');
			}
			entries.push(entry);
		}
		snapshots.push(Object.freeze({ layer, entries: Object.freeze(entries) }));
	}
	return Object.freeze(snapshots);
}

function boundedEntryId(entry: Readonly<Record<string, unknown>>, key: string): string {
	const value = data(entry, key, 'offline video layer entry');
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`offline video layer entry.${key} must be a bounded nonempty string.`);
	}
	return value;
}

function snapshotOptions(value: unknown): NormalizedVideoKeyframeOfflineRgbaRendererOptions {
	const options = record(value, 'offline video RGBA renderer options');
	const keys = Reflect.ownKeys(options);
	const allowed = new Set(['frameSource', 'canvas', 'resolveSource', 'createCompositor', 'compose', 'postprocess']);
	if (keys.length < 3 || keys.length > 6 || keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| !keys.includes('frameSource') || !keys.includes('canvas') || !keys.includes('resolveSource')) {
		throw new TypeError('Offline video RGBA renderer options must be a closed record.');
	}
	for (const key of keys) data(options, String(key), 'offline video RGBA renderer options');
	const frameSource = data(options, 'frameSource', 'offline video RGBA renderer options');
	if (!frameSource || typeof frameSource !== 'object') throw new TypeError('An export frame source is required.');
	const canvas = data(options, 'canvas', 'offline video RGBA renderer options');
	if (!canvas || typeof canvas !== 'object' || typeof (canvas as OfflineCanvas).getContext !== 'function') {
		throw new TypeError('An offline video canvas is required.');
	}
	const resolveSource = data(options, 'resolveSource', 'offline video RGBA renderer options');
	if (typeof resolveSource !== 'function') throw new TypeError('An offline video source resolver is required.');
	const createCompositor = Object.hasOwn(options, 'createCompositor')
		? data(options, 'createCompositor', 'offline video RGBA renderer options')
		: (target: OfflineCanvas): OfflineVideoPreviewCompositor => new VideoPreviewCompositor(target);
	if (typeof createCompositor !== 'function') throw new TypeError('Offline compositor creation must be a function.');
	const compose = Object.hasOwn(options, 'compose')
		? data(options, 'compose', 'offline video RGBA renderer options') : undefined;
	if (compose !== undefined && typeof compose !== 'function') {
		throw new TypeError('Offline RGBA composition must be a function.');
	}
	const postprocess = Object.hasOwn(options, 'postprocess')
		? data(options, 'postprocess', 'offline video RGBA renderer options') : undefined;
	if (postprocess !== undefined && typeof postprocess !== 'function') {
		throw new TypeError('Offline RGBA postprocessing must be a function.');
	}
	return Object.freeze({
		frameSource: frameSource as VideoKeyframeExportFrameSource,
		canvas: canvas as OfflineCanvas,
		resolveSource: resolveSource as VideoKeyframeOfflineSourceResolver,
		createCompositor: createCompositor as (canvas: OfflineCanvas) => OfflineVideoPreviewCompositor,
		...(compose === undefined ? {} : { compose: compose as VideoKeyframeOfflineRgbaCompositor }),
		...(postprocess === undefined ? {} : {
			postprocess: postprocess as VideoKeyframeOfflineRgbaPostprocessor,
		}),
	});
}

function requiredAbortSignal(value: unknown): AbortSignal {
	const options = record(value, 'offline video RGBA produce options');
	if (Reflect.ownKeys(options).length !== 1 || !Object.hasOwn(options, 'signal')) {
		throw new TypeError('Offline video RGBA produce options must contain only signal.');
	}
	const signal = data(options, 'signal', 'offline video RGBA produce options');
	if (typeof AbortSignal === 'undefined' || !(signal instanceof AbortSignal)) {
		throw new TypeError('Offline video RGBA production requires an AbortSignal.');
	}
	return signal;
}

function assertReusableBuffer(value: unknown, byteLength: number): asserts value is Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== byteLength
		|| value.byteOffset !== 0 || value.buffer.byteLength !== byteLength) {
		throw new RangeError('Offline video RGBA output requires one exact whole reusable Uint8Array.');
	}
}

function flipRowsInPlace(value: Uint8Array, scratch: Uint8Array, height: number): void {
	const stride = scratch.byteLength;
	for (let top = 0; top < Math.floor(height / 2); top += 1) {
		const bottom = height - 1 - top;
		const topOffset = top * stride;
		const bottomOffset = bottom * stride;
		scratch.set(value.subarray(topOffset, topOffset + stride));
		value.copyWithin(topOffset, bottomOffset, bottomOffset + stride);
		value.set(scratch, bottomOffset);
	}
}

function assertGlReady(gl: WebGL2RenderingContext): void {
	if (gl.isContextLost()) throw new Error('The offline WebGL video compositor context was lost.');
	const error = gl.getError();
	if (error !== gl.NO_ERROR) throw new Error(`The offline WebGL video compositor failed with ${String(error)}.`);
}

function entryCount(layers: readonly Readonly<Record<string, unknown>>[]): number {
	return layers.reduce((count, layer) => count + (layer.entries as readonly unknown[]).length, 0);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new DOMException('The offline video frame render was cancelled.', 'AbortError');
}
