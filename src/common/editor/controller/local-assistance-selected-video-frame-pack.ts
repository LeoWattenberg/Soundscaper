/* SPDX-License-Identifier: AGPL-3.0-only */

/** Browser-owned exact frame preparation for model-based selected-video analysis. */

import {
	createAssistanceFramePackV1,
} from '../assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_TRANSNET_V2_HEIGHT,
	ASSISTANCE_TRANSNET_V2_WIDTH,
} from '../assistance/transnetv2-onnx-adapter-v1.ts';
import type {
	LocalAssistanceSelectedVideoFramePackTiming,
} from './local-assistance-selected-video-timing.ts';

export const LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE =
	'application/vnd.soundscaper.frame-pack';
export const LOCAL_ASSISTANCE_VIDEO_FRAMES_PER_PACK = 8_192;
export const LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS = 64;

export interface LocalAssistanceDecodedVideoFrame {
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}

export interface LocalAssistanceSelectedVideoFrameDecoder {
	capture(request: Readonly<{
		readonly timestampSeconds: number;
		readonly signal: AbortSignal;
	}>): PromiseLike<LocalAssistanceDecodedVideoFrame> | LocalAssistanceDecodedVideoFrame;
	dispose(): PromiseLike<void> | void;
}

export interface LocalAssistanceSelectedVideoFramePackRequest {
	readonly body: Blob;
	readonly timing: LocalAssistanceSelectedVideoFramePackTiming;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export interface LocalAssistanceSelectedVideoFramePackOptions {
	readonly createDecoder?: (
		body: Blob,
		options: Readonly<{ readonly signal: AbortSignal }>,
	) => PromiseLike<LocalAssistanceSelectedVideoFrameDecoder>
		| LocalAssistanceSelectedVideoFrameDecoder;
	readonly framesPerPack?: number;
}

export async function createLocalAssistanceSelectedVideoFramePacksV1(
	request: LocalAssistanceSelectedVideoFramePackRequest,
	options: LocalAssistanceSelectedVideoFramePackOptions = {},
): Promise<readonly Blob[]> {
	const normalized = normalizeRequest(request);
	if (options.createDecoder !== undefined && typeof options.createDecoder !== 'function') {
		throw new TypeError('Selected-video frame packing needs a decoder factory.');
	}
	const framesPerPack = integer(options.framesPerPack ?? LOCAL_ASSISTANCE_VIDEO_FRAMES_PER_PACK,
		1, LOCAL_ASSISTANCE_VIDEO_FRAMES_PER_PACK, 'selected-video frames per pack');
	const packCount = Math.ceil(normalized.timing.frames.length / framesPerPack);
	if (packCount < 1 || packCount > LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS) {
		throw new RangeError('Selected-video frame packing exceeds its bounded pack inventory.');
	}
	const createDecoder = options.createDecoder ?? defaultDecoder;
	const decoder = await createDecoder(normalized.body, { signal: normalized.signal });
	if (!decoder || typeof decoder.capture !== 'function' || typeof decoder.dispose !== 'function') {
		throw new TypeError('Selected-video frame packing received an invalid decoder.');
	}
	const packs: Blob[] = [];
	try {
		for (let packIndex = 0; packIndex < packCount; packIndex += 1) {
			const first = packIndex * framesPerPack;
			const timings = normalized.timing.frames.slice(first, first + framesPerPack);
			const frames = [];
			for (const timing of timings) {
				assertReady(normalized);
				const decoded = reviewedFrame(await decoder.capture(Object.freeze({
					timestampSeconds: timing.timestampSeconds,
					signal: normalized.signal,
				})));
				assertReady(normalized);
				frames.push(Object.freeze({
					sourceFrame: timing.sourceFrame,
					presentationTick: timing.presentationTick,
					rgba: exactGeometry(decoded),
				}));
			}
			const chunks = createAssistanceFramePackV1({
				width: ASSISTANCE_TRANSNET_V2_WIDTH,
				height: ASSISTANCE_TRANSNET_V2_HEIGHT,
				timescale: normalized.timing.timescale,
				frames,
			});
			packs.push(new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer), {
				type: LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE,
			}));
		}
		assertReady(normalized);
		return Object.freeze(packs);
	} finally {
		await decoder.dispose();
	}
}

function normalizeRequest(
	request: LocalAssistanceSelectedVideoFramePackRequest,
): LocalAssistanceSelectedVideoFramePackRequest {
	if (!request || typeof request !== 'object' || !(request.body instanceof Blob)
		|| request.body.size < 1 || !(request.signal instanceof AbortSignal)
		|| typeof request.assertCurrent !== 'function') {
		throw new TypeError('Selected-video frame packing requires exact source custody.');
	}
	const timing = request.timing;
	if (!timing || typeof timing !== 'object'
		|| !Number.isSafeInteger(timing.timescale) || timing.timescale < 1
		|| timing.timescale > 0x7fff_ffff || !Array.isArray(timing.frames)
		|| timing.frames.length < 1) {
		throw new TypeError('Selected-video frame packing requires bounded timing authority.');
	}
	let priorFrame = -1;
	let priorTick = -1n;
	for (const frame of timing.frames) {
		if (!frame || !Number.isSafeInteger(frame.sourceFrame) || frame.sourceFrame <= priorFrame
			|| typeof frame.presentationTick !== 'string'
			|| !/^(?:0|[1-9]\d*)$/u.test(frame.presentationTick)
			|| BigInt(frame.presentationTick) <= priorTick
			|| typeof frame.timestampSeconds !== 'number'
			|| !Number.isFinite(frame.timestampSeconds) || frame.timestampSeconds < 0) {
			throw new RangeError('Selected-video frame timing is noncanonical or unordered.');
		}
		priorFrame = frame.sourceFrame;
		priorTick = BigInt(frame.presentationTick);
	}
	return Object.freeze({ body: request.body, timing, signal: request.signal,
		assertCurrent: request.assertCurrent });
}

async function defaultDecoder(
	body: Blob,
	options: Readonly<{ readonly signal: AbortSignal }>,
): Promise<LocalAssistanceSelectedVideoFrameDecoder> {
	const media = await import('../video-media.js');
	const extractor = await media.createAudioEditorVideoFrameExtractor(body, options) as Readonly<{
		capture(timestamp: number, options: Readonly<Record<string, unknown>>): Promise<Readonly<{
			readonly blob: Blob;
		}>>;
		dispose(): unknown;
	}>;
	return Object.freeze({
		async capture(request: Readonly<{ timestampSeconds: number; signal: AbortSignal }>) {
			const captured = await extractor.capture(request.timestampSeconds, {
				maximumWidth: ASSISTANCE_TRANSNET_V2_WIDTH,
				maximumHeight: ASSISTANCE_TRANSNET_V2_HEIGHT,
				mimeType: 'image/png', quality: 1, alpha: false, signal: request.signal,
			});
			return decodeImage(captured.blob, request.signal);
		},
		async dispose() { await extractor.dispose(); },
	});
}

async function decodeImage(body: Blob, signal: AbortSignal): Promise<LocalAssistanceDecodedVideoFrame> {
	signal.throwIfAborted();
	if (typeof globalThis.createImageBitmap !== 'function' || !globalThis.document?.createElement) {
		throw new Error('Browser selected-video frame decoding is unavailable.');
	}
	const bitmap = await globalThis.createImageBitmap(body, {
		colorSpaceConversion: 'none', premultiplyAlpha: 'none',
	});
	try {
		signal.throwIfAborted();
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
		if (!context) throw new Error('Browser selected-video RGBA readback is unavailable.');
		context.drawImage(bitmap, 0, 0);
		return Object.freeze({ width: canvas.width, height: canvas.height,
			rgba: Uint8Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) });
	} finally { bitmap.close(); }
}

function reviewedFrame(value: unknown): LocalAssistanceDecodedVideoFrame {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Selected-video decode did not return an RGBA frame.');
	}
	const frame = value as Partial<LocalAssistanceDecodedVideoFrame>;
	const width = integer(frame.width, 1, 16_384, 'selected-video decoded width');
	const height = integer(frame.height, 1, 16_384, 'selected-video decoded height');
	if (!(frame.rgba instanceof Uint8Array) || frame.rgba.byteLength !== width * height * 4) {
		throw new RangeError('Selected-video decoded RGBA geometry is invalid.');
	}
	return Object.freeze({ width, height, rgba: frame.rgba });
}

function exactGeometry(frame: LocalAssistanceDecodedVideoFrame): Uint8Array {
	if (frame.width === ASSISTANCE_TRANSNET_V2_WIDTH
		&& frame.height === ASSISTANCE_TRANSNET_V2_HEIGHT) return frame.rgba.slice();
	const result = new Uint8Array(
		ASSISTANCE_TRANSNET_V2_WIDTH * ASSISTANCE_TRANSNET_V2_HEIGHT * 4,
	);
	for (let y = 0; y < ASSISTANCE_TRANSNET_V2_HEIGHT; y += 1) {
		for (let x = 0; x < ASSISTANCE_TRANSNET_V2_WIDTH; x += 1) {
			const sourceX = Math.min(frame.width - 1,
				Math.floor((x + 0.5) * frame.width / ASSISTANCE_TRANSNET_V2_WIDTH));
			const sourceY = Math.min(frame.height - 1,
				Math.floor((y + 0.5) * frame.height / ASSISTANCE_TRANSNET_V2_HEIGHT));
			const sourceOffset = (sourceY * frame.width + sourceX) * 4;
			result.set(frame.rgba.subarray(sourceOffset, sourceOffset + 4),
				(y * ASSISTANCE_TRANSNET_V2_WIDTH + x) * 4);
		}
	}
	return result;
}

function assertReady(request: LocalAssistanceSelectedVideoFramePackRequest): void {
	request.signal.throwIfAborted();
	request.assertCurrent();
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
