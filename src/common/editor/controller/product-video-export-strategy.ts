/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';
import type {
	VideoKeyframeOfflineRgbaCompositor,
	VideoKeyframeOfflineRgbaPostprocessor,
} from '../ui/video-keyframe-offline-rgba-renderer.ts';
import type {
	BoundVideoSourceTimingView,
	VideoSourceTimingView,
} from '../video-source-timing-view.ts';

export interface ProductVideoExportPlan extends Readonly<Record<string, unknown>> {
	readonly version: number;
	readonly format: 'mp4' | 'webm';
	readonly extension: 'mp4' | 'webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly range: Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
		readonly durationFrames: number;
	}>;
	readonly canvas?: unknown;
	readonly inputs: readonly Readonly<Record<string, unknown>>[];
	readonly activeSourceIds: readonly string[];
}

export interface ProductVideoExportDelivery {
	readonly project: Readonly<Record<string, unknown>>;
	readonly audioRenderedFallback: unknown;
	readonly videoRenderedFallback: unknown;
	readonly requiredAudioSourceIds: readonly unknown[];
	readonly requiredVideoSourceIds: readonly unknown[];
}

export interface ProductVideoExportProjectRequest {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly delivery: ProductVideoExportDelivery;
}

export interface ProductVideoExportStrategyPlanRequest {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly exportProject: Readonly<Record<string, unknown>>;
	readonly format: 'mp4' | 'webm';
	readonly range: unknown;
	readonly includeAudio: boolean;
	readonly canvas: unknown;
	/** Optional: a request that states no tier delivers the one every export used. */
	readonly quality?: unknown;
	/** Optional: a request that states no layout delivers the project's channels. */
	readonly audioLayout?: unknown;
	/** Optional: a request that states no captions delivers none, as every export did. */
	readonly captions?: unknown;
}

export interface ProductVideoExportStrategyEncodeRequest {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly exportProject: Readonly<Record<string, unknown>>;
	readonly plan: ProductVideoExportPlan;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly timingViewsBySourceId?: ReadonlyMap<string, VideoSourceTimingView>;
	readonly videoBlobs: ReadonlyMap<string, Blob>;
	readonly audioMix: Blob | null;
	readonly editorFfmpeg: unknown;
	/**
	 * The delivery's encoder decision, made once where the delivery is decided
	 * and reported. Null means the shipped FFmpeg encodes the picture.
	 */
	readonly webCodecs: Readonly<{ codec: string; bitrate: number }> | null;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly maximumOutputBytes: unknown;
	/** Product-owned picture finishing applied after exact compositing and before encoding. */
	readonly rgbaPostprocessor?: VideoKeyframeOfflineRgbaPostprocessor;
	/** Product-owned exact per-layer picture composition before encoding. */
	readonly rgbaCompositor?: VideoKeyframeOfflineRgbaCompositor;
}

export interface ProductVideoExportEncodedOutput {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	/** Which encoder produced these bytes, so the report states a fact. */
	readonly videoEncoder?: 'ffmpeg' | 'webcodecs';
	readonly codec?: string;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
}

export interface ProductVideoExportSinkOutput<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly chunkCount: number;
	readonly videoEncoder?: 'ffmpeg' | 'webcodecs';
	readonly codec?: string;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
}

export interface ProductVideoExportStrategy {
	createExportProject(request: ProductVideoExportProjectRequest): Readonly<Record<string, unknown>>;
	/** Product-owned picture kinds such as stills and generators on visible tracks. */
	hasPicture?(exportProject: Readonly<Record<string, unknown>>): boolean;
	createPlan(request: ProductVideoExportStrategyPlanRequest): ProductVideoExportPlan | null;
	encode(request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput>;
	encodeToSink<Output>(
		request: ProductVideoExportStrategyEncodeRequest,
		sink: FfmpegOutputSink<Output>,
	): Promise<ProductVideoExportSinkOutput<Output>>;
	/** Optional product authority that requires timing for canonical inactive sources too. */
	captureTimingSourceIds?(plan: ProductVideoExportPlan): readonly string[];
}

/** Read one product-owned strategy without importing a product from common code. */
export function resolveProductVideoExportStrategy(options: unknown): ProductVideoExportStrategy | null {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(options, 'productVideoExportStrategy');
	if (!descriptor) return null;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Product video export strategy must be an own enumerable data property.');
	}
	const strategy = descriptor.value;
	const createExportProject = dataMethod(strategy, 'createExportProject');
	const hasPicture = Object.hasOwn(strategy, 'hasPicture')
		? dataMethod(strategy, 'hasPicture') : undefined;
	const createPlan = dataMethod(strategy, 'createPlan');
	const encode = dataMethod(strategy, 'encode');
	const encodeToSink = dataMethod(strategy, 'encodeToSink');
	const captureTimingSourceIds = Object.hasOwn(strategy, 'captureTimingSourceIds')
		? dataMethod(strategy, 'captureTimingSourceIds') : undefined;
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			return Reflect.apply(createExportProject, strategy, [request]) as Readonly<Record<string, unknown>>;
		},
		...(hasPicture ? {
			hasPicture(exportProject: Readonly<Record<string, unknown>>): boolean {
				const result = Reflect.apply(hasPicture, strategy, [exportProject]);
				if (typeof result !== 'boolean') {
					throw new TypeError('Product video export strategy.hasPicture must return boolean.');
				}
				return result;
			},
		} : {}),
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			return Reflect.apply(createPlan, strategy, [request]) as ProductVideoExportPlan | null;
		},
		encode(request: ProductVideoExportStrategyEncodeRequest) {
			return Promise.resolve(Reflect.apply(encode, strategy, [request]) as (
				PromiseLike<ProductVideoExportEncodedOutput> | ProductVideoExportEncodedOutput
			));
		},
		encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		) {
			return Promise.resolve(Reflect.apply(encodeToSink, strategy, [request, sink]) as (
				PromiseLike<ProductVideoExportSinkOutput<Output>> | ProductVideoExportSinkOutput<Output>
			));
		},
		...(captureTimingSourceIds ? {
			captureTimingSourceIds(plan: ProductVideoExportPlan): readonly string[] {
				return Reflect.apply(captureTimingSourceIds, strategy, [plan]) as readonly string[];
			},
		} : {}),
	});
}

/** Capture a product's complete timing closure while retaining every active source. */
export function captureProductVideoExportTimingSourceIds(
	strategy: ProductVideoExportStrategy,
	plan: ProductVideoExportPlan,
): readonly string[] {
	const active = captureProductVideoExportActiveSourceIds(plan);
	if (strategy.captureTimingSourceIds === undefined) return active;
	const captured = captureSourceIdArray(
		strategy.captureTimingSourceIds(plan), 'timingSourceIds',
	);
	const available = new Set(captured);
	if (active.some((sourceId) => !available.has(sourceId))) {
		throw new RangeError('Product video export timing source IDs must include every active source.');
	}
	return captured;
}

/** Capture exact required source IDs before any timing or media boundary is crossed. */
export function captureProductVideoExportActiveSourceIds(
	plan: ProductVideoExportPlan,
): readonly string[] {
	if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
		throw new TypeError('Product video export plan must be an object.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(plan, 'activeSourceIds');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| !Array.isArray(descriptor.value)
		|| Object.getPrototypeOf(descriptor.value) !== Array.prototype
		|| descriptor.value.length > 4_096) {
		throw new TypeError('Product video export plan activeSourceIds must be an own bounded array.');
	}
	const allowed = new Set<string>(['length']);
	const result: string[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < descriptor.value.length; index += 1) {
		const key = String(index);
		allowed.add(key);
		const entry = Object.getOwnPropertyDescriptor(descriptor.value, key);
		if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) {
			throw new TypeError('Product video export plan activeSourceIds must be a dense data array.');
		}
		const value = entry.value;
		if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
			throw new TypeError(`Product video export plan activeSourceIds[${String(index)}] must be a bounded ID.`);
		}
		if (seen.has(value)) throw new RangeError(`Duplicate product video export active source ID ${value}.`);
		seen.add(value);
		result.push(value);
	}
	if (Reflect.ownKeys(descriptor.value).some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError('Product video export plan activeSourceIds must not carry custom properties.');
	}
	return Object.freeze(result);
}

function captureSourceIdArray(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > 4_096) {
		throw new TypeError(`Product video export ${name} must be a bounded ordinary array.`);
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Product video export ${name} must be a dense data array.`);
		}
		const sourceId = descriptor.value;
		if (typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 256) {
			throw new TypeError(`Product video export ${name}[${String(index)}] must be a bounded ID.`);
		}
		if (seen.has(sourceId)) {
			throw new RangeError(`Duplicate product video export timing source ID ${sourceId}.`);
		}
		seen.add(sourceId);
		result.push(sourceId);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`Product video export ${name} cannot contain named fields.`);
	}
	return Object.freeze(result);
}

function dataMethod(
	value: unknown,
	key: 'createExportProject' | 'hasPicture' | 'createPlan' | 'encode' | 'encodeToSink'
		| 'captureTimingSourceIds',
): (...arguments_: never[]) => unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Product video export strategy must be an object.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError(`Product video export strategy.${key} must be an own enumerable data function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}
