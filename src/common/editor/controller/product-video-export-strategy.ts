/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../ffmpeg-output-stream.ts';
import type { BoundVideoSourceTimingView } from '../video-source-timing-view.ts';

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
}

export interface ProductVideoExportStrategyEncodeRequest {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly exportProject: Readonly<Record<string, unknown>>;
	readonly plan: ProductVideoExportPlan;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly videoBlobs: ReadonlyMap<string, Blob>;
	readonly audioMix: Blob | null;
	readonly editorFfmpeg: unknown;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly maximumOutputBytes: unknown;
}

export interface ProductVideoExportEncodedOutput {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
}

export interface ProductVideoExportSinkOutput<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly chunkCount: number;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
}

export interface ProductVideoExportStrategy {
	createExportProject(request: ProductVideoExportProjectRequest): Readonly<Record<string, unknown>>;
	createPlan(request: ProductVideoExportStrategyPlanRequest): ProductVideoExportPlan | null;
	encode(request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput>;
	encodeToSink<Output>(
		request: ProductVideoExportStrategyEncodeRequest,
		sink: FfmpegOutputSink<Output>,
	): Promise<ProductVideoExportSinkOutput<Output>>;
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
	const createPlan = dataMethod(strategy, 'createPlan');
	const encode = dataMethod(strategy, 'encode');
	const encodeToSink = dataMethod(strategy, 'encodeToSink');
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			return Reflect.apply(createExportProject, strategy, [request]) as Readonly<Record<string, unknown>>;
		},
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
	});
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
	if (result.length < 1) throw new RangeError('Product video export plan requires an active source ID.');
	return Object.freeze(result);
}

function dataMethod(
	value: unknown,
	key: 'createExportProject' | 'createPlan' | 'encode' | 'encodeToSink',
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
