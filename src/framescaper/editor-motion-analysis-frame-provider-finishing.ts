/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import type { GrayVideoFrameV1 } from '../common/editor/video-motion-processing-v27.ts';
import { videoBoundaryTime, type VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import { loadVideoTimingAsset } from '../common/editor/video-timing-storage.ts';
import type { VideoTimingAssetReference } from '../common/editor/video-timing-asset.ts';
import type {
	FramescaperMotionAnalysisFrameProviderFinishing,
	FramescaperMotionAnalysisProgressFinishing,
} from './editor-motion-analysis-actions-finishing.ts';

interface MotionFrameStoreFinishing {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<BlobLike | null>;
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: Readonly<Record<string, unknown>>,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<Readonly<{ readonly blob: BlobLike }> | null>;
}

interface MotionFrameExtractorFinishing {
	capture(
		timestampSeconds: number,
		options?: Readonly<{
			readonly maximumWidth?: number;
			readonly maximumHeight?: number;
			readonly mimeType?: string;
			readonly signal?: AbortSignal;
		}>,
	): PromiseLike<Readonly<{ readonly blob: Blob }>>;
	dispose(): unknown;
}

type MotionFrameExtractorFactoryFinishing = (
	body: Blob,
	options?: Readonly<{ readonly signal?: AbortSignal }>,
) => PromiseLike<MotionFrameExtractorFinishing> | MotionFrameExtractorFinishing;

type MotionGrayDecoderFinishing = (
	body: Blob,
	frameNumber: number,
	signal?: AbortSignal,
) => PromiseLike<GrayVideoFrameV1> | GrayVideoFrameV1;

const MAXIMUM_DECODE_WIDTH = 320;
const MAXIMUM_DECODE_HEIGHT = 180;

/** Build authenticated source-domain gray frames for the selected finishing built-in analyzer. */
export function createFramescaperMotionAnalysisFrameProviderFinishing(options: Readonly<{
	readonly store: MotionFrameStoreFinishing;
	readonly createExtractor?: MotionFrameExtractorFactoryFinishing;
	readonly decodeGray?: MotionGrayDecoderFinishing;
}>): FramescaperMotionAnalysisFrameProviderFinishing {
	if (!options.store || typeof options.store.loadMediaAsset !== 'function') {
		throw new TypeError('The selected finishing motion frame provider requires an original-media store.');
	}
	const createExtractor = options.createExtractor ?? defaultExtractor;
	const decodeGray = options.decodeGray ?? decodeGrayImage;
	return async (request) => {
		throwIfAborted(request.signal);
		const source = sourceRecord(request.source);
		const storageKey = stableId(source.storageKey ?? source.id, 'finishing motion source storage key');
		const expectedDigest = digest(source.contentSha256, 'finishing motion source digest');
		const timestampAt = await sourceTimestampResolver(options.store, source, expectedDigest, request.signal);
		const body = await loadOriginal(
			options.store, request.projectId, source, storageKey, request.signal,
		);
		throwIfAborted(request.signal);
		if (body === null) {
			throw new Error('The selected finishing motion-analysis original is offline or unavailable.');
		}
		if (await digestMediaContent(body, request.signal ? { signal: request.signal } : {}) !== expectedDigest) {
			throw new Error('The selected finishing motion-analysis original changed before authentication.');
		}
		throwIfAborted(request.signal);
		const extractor = await createExtractor(body, request.signal ? { signal: request.signal } : {});
		if (!extractor || typeof extractor.capture !== 'function' || typeof extractor.dispose !== 'function') {
			throw new TypeError('The selected finishing motion frame extractor is invalid.');
		}
		const frames: Array<Readonly<{ readonly frameNumber: number; readonly frame: GrayVideoFrameV1 }>> = [];
		let failure: unknown;
		try {
			const total = request.endFrame - request.startFrame;
			for (let frameNumber = request.startFrame; frameNumber < request.endFrame; frameNumber += 1) {
				throwIfAborted(request.signal);
				const timestamp = timestampAt(frameNumber);
				const captured = await extractor.capture(timestamp, {
					maximumWidth: MAXIMUM_DECODE_WIDTH,
					maximumHeight: MAXIMUM_DECODE_HEIGHT,
					mimeType: 'image/png',
					...(request.signal ? { signal: request.signal } : {}),
				});
				throwIfAborted(request.signal);
				if (!(captured?.blob instanceof Blob)) {
					throw new TypeError('The finishing motion frame extractor returned no pathless image body.');
				}
				const frame = await decodeGray(captured.blob, frameNumber, request.signal);
				throwIfAborted(request.signal);
				frames.push(Object.freeze({ frameNumber, frame }));
				progress(request.onProgress, {
					phase: 'decoding', completed: frames.length, total,
				});
			}
		} catch (error) {
			failure = error;
		}
		try {
			await extractor.dispose();
		} catch (cleanupError) {
			if (failure !== undefined) {
				throw new AggregateError(
					[failure, cleanupError],
					'Motion frame decoding and extractor cleanup both failed.',
					{ cause: failure },
				);
			}
			throw cleanupError;
		}
		if (failure !== undefined) throw failure;
		return Object.freeze(frames);
	};
}

async function loadOriginal(
	store: MotionFrameStoreFinishing,
	projectId: string,
	source: Readonly<Record<string, unknown>>,
	storageKey: string,
	signal?: AbortSignal,
): Promise<Blob | null> {
	const options = signal ? { signal } : {};
	const owned = await store.loadMediaAsset(storageKey, options);
	throwIfAborted(signal);
	if (owned !== null) return browserBlob(owned, signal);
	if (typeof store.resolveLinkedVideoOriginal !== 'function') return null;
	const linked = await store.resolveLinkedVideoOriginal(projectId, source, options);
	throwIfAborted(signal);
	return linked ? browserBlob(linked.blob, signal) : null;
}

async function browserBlob(value: BlobLike, signal?: AbortSignal): Promise<Blob> {
	if (value instanceof Blob) return value;
	const buffer = await value.arrayBuffer();
	throwIfAborted(signal);
	return new Blob([buffer], { type: value.type });
}

async function sourceTimestampResolver(
	store: MotionFrameStoreFinishing,
	source: Readonly<Record<string, unknown>>,
	contentSha256: string,
	signal?: AbortSignal,
): Promise<(frameNumber: number) => number> {
	if (source.timingAsset !== null && source.timingAsset !== undefined) {
		const loaded = await loadVideoTimingAsset({
			loadMediaAsset: async (storageKey, options) => {
				const value = await store.loadMediaAsset(storageKey, options);
				if (value === null || value instanceof Blob) return value;
				return new Blob([await value.arrayBuffer()], { type: value.type });
			},
		}, source.timingAsset as VideoTimingAssetReference, {
			...(signal ? { signal } : {}), sourceSha256: contentSha256,
		});
		throwIfAborted(signal);
		if (loaded.status !== 'available' || !loaded.index) {
			throw new Error(`The selected finishing motion-analysis timing asset is ${loaded.status}.`);
		}
		const timing: VideoSourceTimingView = Object.freeze({
			kind: 'vfr' as const,
			reference: source.timingAsset as Readonly<VideoTimingAssetReference>,
			index: loaded.index,
		});
		return (frameNumber) => midpointSeconds(
			videoBoundaryTime(timing, frameNumber),
			videoBoundaryTime(timing, frameNumber + 1),
		);
	}
	const rate = rationalRate(source.frameRate);
	return (frameNumber) => (frameNumber + 0.5) * rate.den / rate.num;
}

function midpointSeconds(
	start: Readonly<{ readonly numerator: bigint; readonly denominator: bigint }>,
	end: Readonly<{ readonly numerator: bigint; readonly denominator: bigint }>,
): number {
	const numerator = start.numerator * end.denominator + end.numerator * start.denominator;
	const denominator = 2n * start.denominator * end.denominator;
	const seconds = Number(numerator) / Number(denominator);
	if (!Number.isFinite(seconds) || seconds < 0) {
		throw new RangeError('The selected finishing motion-analysis presentation timestamp is unsupported.');
	}
	return seconds;
}

async function defaultExtractor(
	body: Blob,
	options: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<MotionFrameExtractorFinishing> {
	const module = await import('../common/editor/video-media.js');
	return module.createAudioEditorVideoFrameExtractor(body, options) as Promise<MotionFrameExtractorFinishing>;
}

async function decodeGrayImage(
	body: Blob,
	_frameNumber: number,
	signal?: AbortSignal,
): Promise<GrayVideoFrameV1> {
	throwIfAborted(signal);
	if (typeof globalThis.createImageBitmap !== 'function') {
		throw new Error('Browser image decoding is unavailable for selected finishing motion analysis.');
	}
	const bitmap = await globalThis.createImageBitmap(body);
	try {
		throwIfAborted(signal);
		const canvas = createCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
		if (!context || typeof context.drawImage !== 'function' || typeof context.getImageData !== 'function') {
			throw new Error('Canvas pixel readback is unavailable for selected finishing motion analysis.');
		}
		context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
		const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
		const samples = new Array<number>(bitmap.width * bitmap.height);
		for (let pixel = 0, offset = 0; pixel < samples.length; pixel += 1, offset += 4) {
			samples[pixel] = (
				0.2126 * rgba[offset]! + 0.7152 * rgba[offset + 1]! + 0.0722 * rgba[offset + 2]!
			) / 255;
		}
		throwIfAborted(signal);
		const module = await import('../common/editor/video-motion-processing-v27.ts');
		return module.createGrayVideoFrameV1({ width: bitmap.width, height: bitmap.height, samples });
	} finally {
		bitmap.close();
	}
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
	const document = globalThis.document;
	if (!document?.createElement) {
		throw new Error('Browser canvas creation is unavailable for selected finishing motion analysis.');
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function sourceRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A selected finishing video source is required.');
	}
	const source = value as Readonly<Record<string, unknown>>;
	if (source.kind !== undefined && source.kind !== 'video') {
		throw new TypeError('Selected finishing motion analysis requires a video source.');
	}
	return source;
}

function rationalRate(value: unknown): Readonly<{ readonly num: number; readonly den: number }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The finishing motion source frame rate is unavailable.');
	}
	const rate = value as Readonly<Record<string, unknown>>;
	const num = positiveInteger(rate.num, 'finishing motion source rate numerator');
	const den = positiveInteger(rate.den, 'finishing motion source rate denominator');
	return Object.freeze({ num, den });
}

function progress(
	listener: (value: FramescaperMotionAnalysisProgressFinishing) => void,
	value: FramescaperMotionAnalysisProgressFinishing,
): void {
	listener(Object.freeze({ ...value }));
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? new DOMException('Motion frame decoding was cancelled.', 'AbortError');
}
