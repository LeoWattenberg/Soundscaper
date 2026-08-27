/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../storage/media-content-digest.ts';
import {
	admitAudioEditorProjectValidationStructure,
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../project-validation-budget.ts';
import { MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES } from '../project-publication-admission.ts';
import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import { inheritTrackFolderMediaStateProjectionV12 } from '../track-folder-media-runtime.ts';
import {
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrameRequest,
} from '../video-keyframe-export-frame-source.ts';
import {
	createVideoKeyframeExportPresentationAuthority,
} from '../video-keyframe-export-presentation-authority.ts';
import { createVideoRetimeWebCoreOrdinalAuthority } from '../video-retime-web-core-ordinal-authority.ts';
import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';
import type { VideoKeyframeEncoderFormat } from '../video-keyframe-encoder-stream.ts';
import {
	normalizeVideoDeliveryQuality,
	type VideoDeliveryQuality,
} from '../video-delivery-quality.ts';
import {
	encodeVideoKeyframeVideo,
	encodeVideoKeyframeVideoToSink,
	type VideoKeyframeVideoEditorFfmpeg,
	type VideoKeyframeVideoEncoderRequest,
	type VideoKeyframeVideoEncoderResult,
	type VideoKeyframeVideoSinkEncoderResult,
} from '../video-keyframe-video-encoder.ts';
import { manageVideoKeyframeOutputSink } from '../video-keyframe-video-sink.ts';
import type { BoundVideoSourceTimingView } from '../video-source-timing-view.ts';
import { boundVideoSourceTimingViewInfo } from '../video-source-timing-view.ts';
import {
	isVideoExportTimingMap,
	videoExportTimingMapEntries,
} from '../video-export-timing-map.ts';
import {
	createVideoKeyframeOfflineHtmlVideoSourceResolver,
	type VideoKeyframeOfflineHtmlVideoSourceResolver,
	type VideoKeyframeOfflineHtmlVideoSourceResolverOptions,
} from './video-keyframe-offline-html-video-source-resolver.ts';
import {
	createVideoKeyframeOfflineRgbaRenderer,
	type VideoKeyframeOfflineRgbaRenderer,
	type VideoKeyframeOfflineRgbaPostprocessor,
} from './video-keyframe-offline-rgba-renderer.ts';
import {
	planVideoKeyframeOfflineVideoSources,
} from './video-keyframe-offline-video-export-sources.ts';
import {
	createVideoKeyframeOfflineEncoderRequest,
	preflightVideoKeyframeOfflineEncoder,
	type VideoKeyframeOfflineWebCodecsDecision,
} from './video-keyframe-offline-video-export-encoder.ts';
import { runVideoKeyframeOfflineVideoResources } from './video-keyframe-offline-video-export-runner.ts';

interface OfflineCanvas extends HTMLCanvasElement {
	width: number;
	height: number;
}

export interface VideoKeyframeOfflineVideoSourceInput {
	readonly sourceId: string;
	readonly blob: Blob;
}

export interface VideoKeyframeOfflineVideoExportRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly sources: readonly VideoKeyframeOfflineVideoSourceInput[];
	readonly canvas: VideoKeyframeExportFrameRequest['canvas'];
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly format: VideoKeyframeEncoderFormat;
	readonly quality?: VideoDeliveryQuality;
	/** Present when the delivery's capability probe chose the browser's encoder. */
	readonly webCodecs?: VideoKeyframeOfflineWebCodecsDecision;
	/** Required only when no browser encoder decision is present. */
	readonly editorFfmpeg?: VideoKeyframeVideoEditorFfmpeg;
	readonly audioMix?: Blob;
	readonly ringCapacityBytes?: number;
	readonly audioRingCapacityBytes?: number;
	readonly maximumAudioBytes?: number;
	readonly maximumWidth?: number;
	readonly maximumHeight?: number;
	readonly maximumFrameCount?: number;
	readonly maximumTotalRgbaBytes?: number;
	readonly maximumOutputBytes?: number;
	readonly maximumOutputChunkBytes?: number;
	readonly sourceTimeoutMs?: number;
	readonly rgbaPostprocessor?: VideoKeyframeOfflineRgbaPostprocessor;
	readonly rgbaCompositor?: import('./video-keyframe-offline-rgba-renderer.ts').VideoKeyframeOfflineRgbaCompositor;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export interface VideoKeyframeOfflineVideoExportDependencies {
	readonly createCanvas: () => OfflineCanvas;
	readonly createResolver: (
		options: VideoKeyframeOfflineHtmlVideoSourceResolverOptions,
	) => VideoKeyframeOfflineHtmlVideoSourceResolver;
	readonly createRenderer: typeof createVideoKeyframeOfflineRgbaRenderer;
	readonly encodeVideo: typeof encodeVideoKeyframeVideo;
	readonly encodeVideoToSink?: (
		editorFfmpeg: VideoKeyframeVideoEditorFfmpeg | null | undefined,
		request: VideoKeyframeVideoEncoderRequest,
		sink: FfmpegOutputSink<unknown>,
	) => Promise<VideoKeyframeVideoSinkEncoderResult<unknown>>;
}

interface NormalizedRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly sources: readonly Readonly<{ sourceId: string; blob: Blob }>[];
	readonly canvas: VideoKeyframeExportFrameRequest['canvas'];
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly format: VideoKeyframeEncoderFormat;
	readonly quality: VideoDeliveryQuality;
	readonly webCodecs?: VideoKeyframeOfflineWebCodecsDecision;
	readonly editorFfmpeg?: VideoKeyframeVideoEditorFfmpeg;
	readonly audioMix?: Blob;
	readonly encoderOptions: Readonly<Record<string, number>>;
	readonly sourceTimeoutMs?: number;
	readonly rgbaPostprocessor?: VideoKeyframeOfflineRgbaPostprocessor;
	readonly rgbaCompositor?: import('./video-keyframe-offline-rgba-renderer.ts').VideoKeyframeOfflineRgbaCompositor;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

const REQUEST_FIELDS = [
	'project', 'timingBySourceId', 'sources', 'canvas', 'startFrame', 'endFrame',
	'format', 'quality', 'webCodecs', 'editorFfmpeg', 'audioMix', 'ringCapacityBytes', 'audioRingCapacityBytes',
	'maximumAudioBytes', 'maximumWidth', 'maximumHeight',
	'maximumFrameCount', 'maximumTotalRgbaBytes', 'maximumOutputBytes',
	'maximumOutputChunkBytes', 'sourceTimeoutMs', 'rgbaPostprocessor', 'rgbaCompositor', 'signal', 'assertCurrent',
] as const;
const ENCODER_OPTION_FIELDS = [
	'ringCapacityBytes', 'audioRingCapacityBytes', 'maximumAudioBytes',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount',
	'maximumTotalRgbaBytes', 'maximumOutputBytes', 'maximumOutputChunkBytes',
] as const;
const MAXIMUM_SOURCE_COUNT = 4_096;
const MAXIMUM_SOURCE_TIMEOUT_MS = 30_000;
const DEFAULT_DEPENDENCIES: VideoKeyframeOfflineVideoExportDependencies = Object.freeze({
	createCanvas(): OfflineCanvas {
		if (!globalThis.document || typeof globalThis.document.createElement !== 'function') {
			throw new Error('Offline video export requires a browser canvas.');
		}
		return globalThis.document.createElement('canvas');
	},
	createResolver: createVideoKeyframeOfflineHtmlVideoSourceResolver,
	createRenderer: createVideoKeyframeOfflineRgbaRenderer,
	encodeVideo: encodeVideoKeyframeVideo,
	encodeVideoToSink: encodeVideoKeyframeVideoToSink,
});

/** Authenticate and encode one dormant exact browser RGBA export, publishing only after cleanup. */
export async function encodeVideoKeyframeOfflineVideo(
	requestValue: VideoKeyframeOfflineVideoExportRequest,
	dependenciesValue: VideoKeyframeOfflineVideoExportDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeVideoEncoderResult> {
	return executeOfflineVideo(requestValue, dependenciesValue, (dependencies, request) => (
		(encoderRequest_) => dependencies.encodeVideo(request.editorFfmpeg, encoderRequest_)
	)) as Promise<VideoKeyframeVideoEncoderResult>;
}

/** Stream an exact keyed export directly without retaining its complete video bytes. */
export async function encodeVideoKeyframeOfflineVideoToSink<Output>(
	requestValue: VideoKeyframeOfflineVideoExportRequest,
	sink: FfmpegOutputSink<Output>,
	dependenciesValue: VideoKeyframeOfflineVideoExportDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeVideoSinkEncoderResult<Output>> {
	const managedSink = manageVideoKeyframeOutputSink(sink);
	try {
		return await executeOfflineVideo(requestValue, dependenciesValue, (dependencies, request) => (
			(encoderRequest_) => dependencies.encodeVideoToSink
				? dependencies.encodeVideoToSink(
					request.editorFfmpeg, encoderRequest_, managedSink.value,
				) as Promise<VideoKeyframeVideoSinkEncoderResult<Output>>
				: encodeVideoKeyframeVideoToSink(
					request.editorFfmpeg, encoderRequest_, managedSink.value,
				)
		)) as VideoKeyframeVideoSinkEncoderResult<Output>;
	} catch (error) {
		throw await managedSink.abort(error);
	}
}

async function executeOfflineVideo<Output>(
	requestValue: VideoKeyframeOfflineVideoExportRequest,
	dependenciesValue: VideoKeyframeOfflineVideoExportDependencies,
	createEncoder: (
		dependencies: VideoKeyframeOfflineVideoExportDependencies,
		request: NormalizedRequest,
	) => (encoderRequest: VideoKeyframeVideoEncoderRequest) => Promise<
		VideoKeyframeVideoEncoderResult | VideoKeyframeVideoSinkEncoderResult<Output>
	>,
): Promise<VideoKeyframeVideoEncoderResult | VideoKeyframeVideoSinkEncoderResult<Output>> {
	const request = normalizeRequest(requestValue);
	const dependencies = normalizeDependencies(dependenciesValue);
	const encode = createEncoder(dependencies, request);
	assertReady(request);
	const project = request.project;
	const runtimeProject = inheritTrackFolderMediaStateProjectionV12(
		project,
		projectForRuntimeConsumers(project),
	);
	const sourcePlan = planVideoKeyframeOfflineVideoSources({
		...request,
		project: runtimeProject,
	});
	const exactOrdinalAuthority = createVideoRetimeWebCoreOrdinalAuthority({
		project: runtimeProject,
		timingBySourceId: request.timingBySourceId,
		...(request.startFrame === undefined ? {} : { startFrame: request.startFrame }),
		...(request.endFrame === undefined ? {} : { endFrame: request.endFrame }),
		outputRate: request.canvas.frameRate,
	});
	const authority = createVideoKeyframeExportPresentationAuthority({
		project: sourcePlan.project,
		timingBySourceId: request.timingBySourceId,
		exactOrdinalAuthority,
	});
	const frameSource = createVideoKeyframeExportFrameSource({
		project: runtimeProject,
		canvas: request.canvas,
		...(request.startFrame === undefined ? {} : { startFrame: request.startFrame }),
		...(request.endFrame === undefined ? {} : { endFrame: request.endFrame }),
		resolvePresentationDescriptor: authority.resolvePresentationDescriptor,
	});
	if (frameSource.frameCount !== exactOrdinalAuthority.outputFrameCount) {
		throw new RangeError('The browser video frame source disagrees with its exact ordinal authority.');
	}
	await preflightVideoKeyframeOfflineEncoder(request, frameSource);
	const assets = await sourcePlan.authenticate(
		request.sources,
		authority.presentationForEntry,
		Object.freeze({ signal: request.signal, assertCurrent: request.assertCurrent }),
	);
	assertReady(request);
	const result = await runVideoKeyframeOfflineVideoResources(
		() => dependencies.createResolver(Object.freeze({
			sources: assets,
			...(request.sourceTimeoutMs === undefined ? {} : { timeoutMs: request.sourceTimeoutMs }),
		})),
		(resolver) => {
			const canvas = dependencies.createCanvas();
			canvas.width = frameSource.canvas.width;
			canvas.height = frameSource.canvas.height;
			const renderer = dependencies.createRenderer(Object.freeze({
				frameSource,
				canvas,
				resolveSource: resolver.resolveSource,
				...(request.rgbaPostprocessor === undefined ? {} : {
					postprocess: request.rgbaPostprocessor,
				}),
				...(request.rgbaCompositor === undefined ? {} : { compose: request.rgbaCompositor }),
			}));
			return Object.freeze({
				renderer,
				request: createVideoKeyframeOfflineEncoderRequest(request, frameSource, renderer),
			});
		},
		encode,
		() => assertReady(request),
	);
	return result;
}

function normalizeRequest(value: unknown): NormalizedRequest {
	const request = closedRecord(value, 'offline video export request', REQUEST_FIELDS);
	if (request.format !== 'mp4' && request.format !== 'webm') {
		throw new RangeError('Offline video export format must be mp4 or webm.');
	}
	if (!(request.signal instanceof AbortSignal)) throw new TypeError('Offline video export requires an AbortSignal.');
	if (typeof request.assertCurrent !== 'function') throw new TypeError('Offline video export requires assertCurrent.');
	if (request.rgbaPostprocessor !== undefined && typeof request.rgbaPostprocessor !== 'function') {
		throw new TypeError('Offline video export rgbaPostprocessor must be a function.');
	}
	if (request.rgbaCompositor !== undefined && typeof request.rgbaCompositor !== 'function') {
		throw new TypeError('Offline video export rgbaCompositor must be a function.');
	}
	const startFrame = request.startFrame === undefined
		? undefined
		: nonNegativeSafeInteger(request.startFrame, 'offline video export startFrame');
	const endFrame = request.endFrame === undefined
		? undefined
		: positiveSafeInteger(request.endFrame, 'offline video export endFrame');
	if (startFrame !== undefined && endFrame !== undefined && endFrame <= startFrame) {
		throw new RangeError('Offline video export endFrame must exceed startFrame.');
	}
	const sourceTimeoutMs = request.sourceTimeoutMs === undefined
		? undefined
		: boundedPositiveSafeInteger(
			request.sourceTimeoutMs, MAXIMUM_SOURCE_TIMEOUT_MS, 'offline video export sourceTimeoutMs',
		);
	const project = snapshotProject(request.project);
	const timingBySourceId = snapshotTiming(request.timingBySourceId);
	const sourceValues = denseArray(request.sources, 'offline video export sources', MAXIMUM_SOURCE_COUNT);
	const sources: Readonly<{ sourceId: string; blob: Blob }>[] = [];
	const sourceIds = new Set<string>();
	for (const [index, value_] of sourceValues.entries()) {
		const source = closedRecord(value_, `offline video export sources[${String(index)}]`, ['sourceId', 'blob']);
		const sourceId = boundedId(source.sourceId, `offline video export sources[${String(index)}].sourceId`);
		if (sourceIds.has(sourceId)) throw new RangeError(`Duplicate offline video source ID ${sourceId}.`);
		sourceIds.add(sourceId);
		const blob = Object.freeze(canonicalMediaContentBlob(source.blob));
		if (blob.size < 1) throw new RangeError('Offline video source Blobs must not be empty.');
		sources.push(Object.freeze({ sourceId, blob }));
	}
	const encoderOptions: Record<string, number> = {};
	for (const key of ENCODER_OPTION_FIELDS) {
		if (request[key] !== undefined) encoderOptions[key] = request[key] as number;
	}
	if (request.audioMix === undefined
		&& (request.audioRingCapacityBytes !== undefined || request.maximumAudioBytes !== undefined)) {
		throw new TypeError('Offline video export audio options require audioMix.');
	}
	const webCodecs = request.webCodecs === undefined
		? undefined
		: snapshotWebCodecs(request.webCodecs);
	const editorFfmpeg = webCodecs === undefined
		? snapshotEditorFfmpeg(request.editorFfmpeg)
		: undefined;
	return Object.freeze({
		project,
		timingBySourceId,
		sources: Object.freeze(sources),
		canvas: snapshotCanvas(request.canvas),
		...(startFrame === undefined ? {} : { startFrame }),
		...(endFrame === undefined ? {} : { endFrame }),
		format: request.format,
		quality: normalizeVideoDeliveryQuality(request.quality, 'offline video export quality'),
		...(webCodecs === undefined ? { editorFfmpeg } : { webCodecs }),
		...(request.audioMix === undefined ? {} : {
			audioMix: canonicalMediaContentBlob(request.audioMix),
		}),
		encoderOptions: Object.freeze(encoderOptions),
		...(sourceTimeoutMs === undefined ? {} : { sourceTimeoutMs }),
		...(request.rgbaPostprocessor === undefined ? {} : {
			rgbaPostprocessor: request.rgbaPostprocessor as VideoKeyframeOfflineRgbaPostprocessor,
		}),
		...(request.rgbaCompositor === undefined ? {} : {
			rgbaCompositor: request.rgbaCompositor as import('./video-keyframe-offline-rgba-renderer.ts').VideoKeyframeOfflineRgbaCompositor,
		}),
		signal: request.signal,
		assertCurrent: request.assertCurrent as () => void,
	});
}

function snapshotProject(value: unknown): Readonly<Record<string, unknown>> {
	const project = record(value, 'offline video export project');
	admitAudioEditorProjectValidationStructure(
		project,
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	);
	assertSnapshotPayloadBound(project);
	let snapshot: unknown;
	try { snapshot = structuredClone(project); } catch (cause) {
		throw new TypeError('Offline video export project must be structured-clone data.', { cause });
	}
	return inheritTrackFolderMediaStateProjectionV12(
		project,
		deepFreeze(record(snapshot, 'offline video export project snapshot')),
	);
}

function assertSnapshotPayloadBound(value: object): void {
	const stack: unknown[] = [value];
	const seen = new WeakSet<object>();
	let textCodeUnits = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current === 'string') {
			textCodeUnits += current.length;
			if (textCodeUnits > MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES) {
				throw new RangeError('Offline video export project text exceeds its snapshot byte bound.');
			}
			continue;
		}
		if (!current || typeof current !== 'object' || seen.has(current)) continue;
		if (isBinary(current)) {
			throw new TypeError('Offline video export projects cannot embed binary data.');
		}
		seen.add(current);
		for (const key of Reflect.ownKeys(current)) {
			stack.push(Object.getOwnPropertyDescriptor(current, key)?.value);
		}
	}
}

function isBinary(value: object): boolean {
	return value instanceof ArrayBuffer
		|| ArrayBuffer.isView(value)
		|| (typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer);
}

function snapshotTiming(value: unknown): ReadonlyMap<string, BoundVideoSourceTimingView> {
	if (!(value instanceof Map) && !isVideoExportTimingMap(value)) {
		throw new TypeError('Offline video export timing must be a ReadonlyMap.');
	}
	const result = new Map<string, BoundVideoSourceTimingView>();
	const iterator: Iterable<readonly [unknown, unknown]> = isVideoExportTimingMap(value)
		? videoExportTimingMapEntries(value)
		: Reflect.apply(Map.prototype.entries, value, []) as MapIterator<[unknown, unknown]>;
	for (const [keyValue, timingValue] of iterator) {
		const key = boundedId(keyValue, 'offline video export timing source ID');
		if (result.size >= MAXIMUM_SOURCE_COUNT) throw new RangeError('Offline video export timing sources exceed their limit.');
		const info = boundVideoSourceTimingViewInfo(timingValue);
		if (info.sourceId !== key) throw new Error(`Offline video export timing key ${key} is mismatched.`);
		result.set(key, timingValue as BoundVideoSourceTimingView);
	}
	return result;
}

function snapshotCanvas(value: unknown): VideoKeyframeExportFrameRequest['canvas'] {
	// `fit` decides how a source of another aspect lands in the delivered
	// extents, so it travels with them. Dropping it here would letterbox a
	// delivery the plan asked to crop, and refusing it refuses every keyed
	// export, because a plan canvas always states one.
	const canvas = closedRecord(
		value, 'offline video export canvas', ['width', 'height', 'frameRate', 'fit', 'backgroundColor'],
	);
	const frameRate = typeof canvas.frameRate === 'object' && canvas.frameRate !== null
		? closedRecord(canvas.frameRate, 'offline video export frame rate', ['num', 'den'])
		: canvas.frameRate;
	return Object.freeze({
		width: canvas.width as number,
		height: canvas.height as number,
		frameRate: frameRate as VideoKeyframeExportFrameRequest['canvas']['frameRate'],
		...(canvas.backgroundColor === undefined ? {} : {
			backgroundColor: canvas.backgroundColor as string,
		}),
		...(canvas.fit === undefined ? {} : {
			fit: canvas.fit as NonNullable<VideoKeyframeExportFrameRequest['canvas']['fit']>,
		}),
	});
}

function snapshotWebCodecs(value: unknown): VideoKeyframeOfflineWebCodecsDecision {
	const decision = closedRecord(value, 'offline video export webCodecs', ['codec', 'bitrate']);
	const codec = decision.codec;
	const bitrate = decision.bitrate;
	if (typeof codec !== 'string' || codec.length === 0) {
		throw new TypeError('offline video export webCodecs.codec must be a codec string.');
	}
	if (typeof bitrate !== 'number' || !Number.isSafeInteger(bitrate) || bitrate < 1) {
		throw new RangeError('offline video export webCodecs.bitrate must be a positive safe integer.');
	}
	return Object.freeze({ codec, bitrate });
}

function snapshotEditorFfmpeg(value: unknown): VideoKeyframeVideoEditorFfmpeg {
	const operation = ownFunction(value, 'runVideoKeyframeEncoderOperation', 'offline video export FFmpeg owner');
	return Object.freeze({
		runVideoKeyframeEncoderOperation(...arguments_: unknown[]) {
			return Reflect.apply(operation, value, arguments_);
		},
	}) as VideoKeyframeVideoEditorFfmpeg;
}

function normalizeDependencies(value: unknown): VideoKeyframeOfflineVideoExportDependencies {
	const dependencies = closedRecord(value, 'offline video export dependencies', [
		'createCanvas', 'createResolver', 'createRenderer', 'encodeVideo', 'encodeVideoToSink',
	]);
	const createCanvas = ownFunction(dependencies, 'createCanvas', 'offline video export dependencies');
	const createResolver = ownFunction(dependencies, 'createResolver', 'offline video export dependencies');
	const createRenderer = ownFunction(dependencies, 'createRenderer', 'offline video export dependencies');
	const encodeVideo = ownFunction(dependencies, 'encodeVideo', 'offline video export dependencies');
	const encodeVideoToSink = Object.hasOwn(dependencies, 'encodeVideoToSink')
		? ownFunction(dependencies, 'encodeVideoToSink', 'offline video export dependencies')
		: undefined;
	return Object.freeze({
		createCanvas: () => Reflect.apply(createCanvas, value, []) as OfflineCanvas,
		createResolver: (options: VideoKeyframeOfflineHtmlVideoSourceResolverOptions) => Reflect.apply(
			createResolver, value, [options],
		) as VideoKeyframeOfflineHtmlVideoSourceResolver,
		createRenderer: ((options: Parameters<typeof createVideoKeyframeOfflineRgbaRenderer>[0]) => Reflect.apply(
			createRenderer, value, [options],
		) as VideoKeyframeOfflineRgbaRenderer) as typeof createVideoKeyframeOfflineRgbaRenderer,
		encodeVideo: ((...arguments_: Parameters<typeof encodeVideoKeyframeVideo>) => Reflect.apply(
			encodeVideo, value, arguments_,
		) as ReturnType<typeof encodeVideoKeyframeVideo>) as typeof encodeVideoKeyframeVideo,
		...(encodeVideoToSink ? {
			encodeVideoToSink: ((...arguments_: Parameters<typeof encodeVideoKeyframeVideoToSink<unknown>>) => Reflect.apply(
				encodeVideoToSink, value, arguments_,
			) as ReturnType<typeof encodeVideoKeyframeVideoToSink<unknown>>),
		} : {}),
	});
}

function ownFunction(value: unknown, key: string, name: string): (...arguments_: never[]) => unknown {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`${name} must be an object.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
		throw new TypeError(`${name}.${key} must be an enumerable own data function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}

function deepFreeze<Value extends Readonly<Record<string, unknown>>>(value: Value): Value {
	const stack: object[] = [value];
	const seen = new WeakSet<object>();
	const order: object[] = [];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		if (isBinary(current)) {
			throw new TypeError('Offline video export projects cannot embed binary data.');
		}
		order.push(current);
		for (const key of Reflect.ownKeys(current)) {
			const nested = Object.getOwnPropertyDescriptor(current, key)?.value;
			if (nested && typeof nested === 'object') stack.push(nested as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}

function assertReady(request: Pick<NormalizedRequest, 'signal' | 'assertCurrent'>): void {
	if (request.signal.aborted) throw request.signal.reason ?? new DOMException('Offline video export was cancelled.', 'AbortError');
	request.assertCurrent();
}

function closedRecord(value: unknown, name: string, allowed: readonly string[]): Readonly<Record<string, unknown>> {
	const source = record(value, name);
	const keys = Reflect.ownKeys(source);
	if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))) {
		throw new TypeError(`${name} has an unsupported field.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) result[String(key)] = data(source, String(key), name);
	return Object.freeze(result);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an own data property.`);
	return descriptor.value;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} must be dense own data.`);
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} cannot contain named fields.`);
	return Object.freeze(result);
}

function boundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} must be a bounded ID.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result < 1) throw new RangeError(`${name} must be positive.`);
	return result;
}

function boundedPositiveSafeInteger(value: unknown, maximum: number, name: string): number {
	const result = positiveSafeInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} cannot exceed ${String(maximum)}.`);
	return result;
}
