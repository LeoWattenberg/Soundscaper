/* SPDX-License-Identifier: AGPL-3.0-only */

/** Traversal-independent source-domain RGBA access for selected V27 finishing. */

import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import {
	videoBoundaryTime,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';

interface FrameDecoderV27 {
	capture(request: Readonly<{
		readonly timestampSeconds: number;
		readonly width: number;
		readonly height: number;
		readonly signal: AbortSignal;
	}>): PromiseLike<UnifiedExactRenderRgbaFrameV13> | UnifiedExactRenderRgbaFrameV13;
	dispose(): PromiseLike<void> | void;
}

type FrameDecoderFactoryV27 = (
	body: Blob,
	options: Readonly<{ readonly signal: AbortSignal }>,
) => PromiseLike<FrameDecoderV27> | FrameDecoderV27;

export interface FramescaperVideoFrameAddressV27 {
	resolve(request: Readonly<{
		readonly sourceId: string;
		readonly sourceFrame: number;
		readonly width: number;
		readonly height: number;
		readonly signal: AbortSignal;
	}>): Promise<UnifiedExactRenderRgbaFrameV13>;
	dispose(): Promise<void>;
}

const DEFAULT_MAXIMUM_CACHE_BYTES = 128 * 1024 * 1024;

/** Cache only successful decodes; exact timing and ordinals remain the authority after eviction. */
export function createFramescaperVideoFrameAddressV27(options: Readonly<{
	readonly sources: ReadonlyMap<string, Blob>;
	readonly timingViewsBySourceId: ReadonlyMap<string, VideoSourceTimingView>;
	readonly createDecoder?: FrameDecoderFactoryV27;
	readonly maximumCacheBytes?: number;
}>): FramescaperVideoFrameAddressV27 {
	if (!(options?.sources instanceof Map) || !(options.timingViewsBySourceId instanceof Map)) {
		throw new TypeError('Selected V27 frame addressing requires source and timing maps.');
	}
	const sources = new Map(options.sources);
	const timing = new Map(options.timingViewsBySourceId);
	if (sources.size > 4_096
		|| [...sources].some(([id, body]) => !stableId(id) || !(body instanceof Blob) || !timing.has(id))) {
		throw new RangeError('Selected V27 frame-address source authority is inconsistent.');
	}
	const createDecoder = options.createDecoder ?? defaultDecoder;
	if (typeof createDecoder !== 'function') throw new TypeError('A V27 frame decoder factory is required.');
	const maximumCacheBytes = options.maximumCacheBytes === undefined
		? DEFAULT_MAXIMUM_CACHE_BYTES
		: positiveInteger(options.maximumCacheBytes, 'V27 frame cache byte limit');
	const decoders = new Map<string, FrameDecoderV27>();
	const cache = new Map<string, UnifiedExactRenderRgbaFrameV13>();
	let retainedBytes = 0;
	let disposed = false;
	let disposePromise: Promise<void> | null = null;

	async function resolve(request: Parameters<FramescaperVideoFrameAddressV27['resolve']>[0]) {
		if (disposed) throw new Error('Selected V27 frame addressing is closed.');
		const sourceId = requiredId(request?.sourceId, 'V27 addressed source ID');
		const sourceFrame = nonNegativeInteger(request?.sourceFrame, 'V27 addressed source frame');
		const width = positiveInteger(request?.width, 'V27 addressed frame width');
		const height = positiveInteger(request?.height, 'V27 addressed frame height');
		const signal = abortSignal(request?.signal);
		throwIfAborted(signal);
		const view = timing.get(sourceId);
		const body = sources.get(sourceId);
		if (!view || !body) throw new ReferenceError(`Selected V27 source ${sourceId} is unavailable.`);
		const frameCount = view.kind === 'cfr' ? view.frameCount : view.index.frameCount;
		if (sourceFrame >= frameCount) throw new RangeError('Selected V27 source frame exceeds its timing view.');
		const key = `${sourceId}:${String(sourceFrame)}:${String(width)}x${String(height)}`;
		const cached = cache.get(key);
		if (cached) {
			cache.delete(key);
			cache.set(key, cached);
			return cloneFrame(cached);
		}
		let decoder = decoders.get(sourceId);
		if (!decoder) {
			decoder = await createDecoder(body, Object.freeze({ signal }));
			throwIfAborted(signal);
			if (!decoder || typeof decoder.capture !== 'function' || typeof decoder.dispose !== 'function') {
				throw new TypeError('The selected V27 frame decoder is invalid.');
			}
			decoders.set(sourceId, decoder);
		}
		const decoded = checkedFrame(await decoder.capture(Object.freeze({
			timestampSeconds: midpointSeconds(
				videoBoundaryTime(view, sourceFrame), videoBoundaryTime(view, sourceFrame + 1),
			),
			width, height, signal,
		})), 'Selected V27 addressed frame');
		throwIfAborted(signal);
		const frame = decoded.width === width && decoded.height === height
			? decoded : resizeFrame(decoded, width, height);
		const byteLength = frame.pixels.byteLength;
		while (cache.size > 0 && retainedBytes + byteLength > maximumCacheBytes) {
			const oldest = cache.keys().next().value as string;
			retainedBytes -= cache.get(oldest)!.pixels.byteLength;
			cache.delete(oldest);
		}
		if (byteLength <= maximumCacheBytes) {
			cache.set(key, frame);
			retainedBytes += byteLength;
		}
		return cloneFrame(frame);
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposed = true;
		cache.clear();
		retainedBytes = 0;
		disposePromise = (async () => {
			const failures: unknown[] = [];
			for (const decoder of decoders.values()) {
				try { await decoder.dispose(); } catch (error) { failures.push(error); }
			}
			decoders.clear();
			if (failures.length > 0) throw new AggregateError(failures, 'V27 frame decoder cleanup failed.');
		})();
		return disposePromise;
	}

	return Object.freeze({ resolve, dispose });
}

async function defaultDecoder(
	body: Blob,
	options: Readonly<{ readonly signal: AbortSignal }>,
): Promise<FrameDecoderV27> {
	const module = await import('../common/editor/video-media.js');
	const extractor = await module.createAudioEditorVideoFrameExtractor(body, options) as Readonly<{
		capture(timestamp: number, options: Readonly<Record<string, unknown>>): Promise<Readonly<{ blob: Blob }>>;
		dispose(): unknown;
	}>;
	return Object.freeze({
		async capture(request: Parameters<FrameDecoderV27['capture']>[0]) {
			const captured = await extractor.capture(request.timestampSeconds, {
				maximumWidth: request.width, maximumHeight: request.height,
				mimeType: 'image/png', alpha: true, signal: request.signal,
			});
			return decodeImage(captured.blob, request.signal);
		},
		async dispose() { await extractor.dispose(); },
	});
}

async function decodeImage(body: Blob, signal: AbortSignal): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	if (typeof globalThis.createImageBitmap !== 'function' || !globalThis.document?.createElement) {
		throw new Error('Selected V27 frame-address image decoding is unavailable.');
	}
	const bitmap = await globalThis.createImageBitmap(body, {
		colorSpaceConversion: 'none', premultiplyAlpha: 'none',
	});
	try {
		throwIfAborted(signal);
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Selected V27 frame-address readback is unavailable.');
		context.drawImage(bitmap, 0, 0);
		const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
		return Object.freeze({
			width: canvas.width, height: canvas.height,
			pixels: Uint8Array.from(data) as Uint8Array<ArrayBuffer>,
		});
	} finally { bitmap.close(); }
}

function resizeFrame(
	frame: UnifiedExactRenderRgbaFrameV13,
	width: number,
	height: number,
): UnifiedExactRenderRgbaFrameV13 {
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const sourceX = Math.min(frame.width - 1, Math.floor((x + 0.5) * frame.width / width));
		const sourceY = Math.min(frame.height - 1, Math.floor((y + 0.5) * frame.height / height));
		const sourceOffset = (sourceY * frame.width + sourceX) * 4;
		pixels.set(frame.pixels.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
	}
	return Object.freeze({ width, height, pixels });
}

function checkedFrame(value: unknown, name: string): UnifiedExactRenderRgbaFrameV13 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an RGBA frame.`);
	const frame = value as Partial<UnifiedExactRenderRgbaFrameV13>;
	const width = positiveInteger(frame.width, `${name} width`);
	const height = positiveInteger(frame.height, `${name} height`);
	if (!(frame.pixels instanceof Uint8Array) || frame.pixels.byteLength !== width * height * 4) {
		throw new RangeError(`${name} has invalid RGBA geometry.`);
	}
	return Object.freeze({ width, height, pixels: Uint8Array.from(frame.pixels) as Uint8Array<ArrayBuffer> });
}

function cloneFrame(frame: UnifiedExactRenderRgbaFrameV13): UnifiedExactRenderRgbaFrameV13 {
	return Object.freeze({ width: frame.width, height: frame.height, pixels: frame.pixels.slice() });
}

function midpointSeconds(
	start: Readonly<{ numerator: bigint; denominator: bigint }>,
	end: Readonly<{ numerator: bigint; denominator: bigint }>,
): number {
	const numerator = start.numerator * end.denominator + end.numerator * start.denominator;
	const denominator = 2n * start.denominator * end.denominator;
	const value = Number(numerator) / Number(denominator);
	if (!Number.isFinite(value) || value < 0) throw new RangeError('V27 frame timestamp is unsupported.');
	return value;
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('V27 frame addressing requires an AbortSignal.');
	return value;
}

function requiredId(value: unknown, name: string): string {
	if (!stableId(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function stableId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 268_435_456) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('V27 frame addressing was aborted.', 'AbortError');
}
