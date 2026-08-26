/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperBrowserNativeImageDecodeSessionV1,
	OpenFramescaperBrowserNativeImageV1,
} from './timeline-image-native-decode-v1.ts';

interface BrowserImageTrackLike {
	readonly frameCount?: number;
}

interface BrowserImageTracksLike {
	readonly ready: PromiseLike<void>;
	readonly selectedTrack?: BrowserImageTrackLike | null;
}

interface BrowserDecodedImageLike {
	readonly displayWidth?: number;
	readonly displayHeight?: number;
	readonly duration?: number | null;
	close(): void;
}

interface BrowserImageDecoderLike {
	readonly tracks: BrowserImageTracksLike;
	readonly complete?: boolean;
	decode(options: Readonly<{ frameIndex: number; completeFramesOnly: boolean }>): PromiseLike<Readonly<{
		readonly image: BrowserDecodedImageLike;
		readonly complete: boolean;
	}>>;
	close(): void;
}

interface BrowserImageDecoderConstructor {
	new(options: Readonly<{
		data: Uint8Array;
		type: string;
		preferAnimation: boolean;
		colorSpaceConversion: 'default';
	}>): BrowserImageDecoderLike;
	isTypeSupported?(type: string): PromiseLike<boolean>;
}

type BrowserCanvas = OffscreenCanvas | HTMLCanvasElement;

/** Open the browser's qualified ImageDecoder, falling back to one static ImageBitmap. */
export const openFramescaperBrowserNativeImageV1: OpenFramescaperBrowserNativeImageV1 = async (
	request,
): Promise<FramescaperBrowserNativeImageDecodeSessionV1> => {
	cancelled(request.signal);
	const Decoder = imageDecoderConstructor();
	if (Decoder && await supported(Decoder, request.mimeType)) {
		return openImageDecoder(Decoder, request.bytes, request.mimeType, request.signal);
	}
	return openStaticBitmap(request.bytes, request.mimeType, request.signal);
};

async function openImageDecoder(
	Decoder: BrowserImageDecoderConstructor,
	bytes: Uint8Array,
	mimeType: string,
	signal: AbortSignal | undefined,
): Promise<FramescaperBrowserNativeImageDecodeSessionV1> {
	const decoder = new Decoder({
		data: bytes.slice(), type: mimeType, preferAnimation: true, colorSpaceConversion: 'default',
	});
	try {
		await decoder.tracks.ready;
		cancelled(signal);
		const track = decoder.tracks.selectedTrack;
		const frameCount = positiveInteger(track?.frameCount, 'ImageDecoder frame count');
		const probe = await decoder.decode({ frameIndex: 0, completeFramesOnly: true });
		let width: number;
		let height: number;
		try {
			cancelled(signal);
			width = positiveInteger(probe.image.displayWidth, 'ImageDecoder display width');
			height = positiveInteger(probe.image.displayHeight, 'ImageDecoder display height');
		} finally { probe.image.close(); }
		let closed = false;
		return Object.freeze({
			metadata: Object.freeze({
				width, height, frameCount,
				topology: frameCount === 1 ? 'single' as const : 'animated' as const,
				runtimeVersion: 'webcodecs-image-decoder-v1',
			}),
			async decodeFrame(index: number, frameSignal?: AbortSignal) {
				if (closed) throw new Error('The browser image decoder is closed.');
				cancelled(frameSignal ?? signal);
				const result = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
				const image = result.image;
				try {
					cancelled(frameSignal ?? signal);
					assertFrameDimensions(image, width, height);
					return Object.freeze({
						rgba: drawRgba(image as unknown as CanvasImageSource, width, height),
						durationMicroseconds: normalizedDuration(image.duration),
					});
				} finally { image.close(); }
			},
			close() { if (!closed) { closed = true; decoder.close(); } },
		});
	} catch (error) {
		decoder.close();
		throw error;
	}
}

async function openStaticBitmap(
	bytes: Uint8Array,
	mimeType: string,
	signal: AbortSignal | undefined,
): Promise<FramescaperBrowserNativeImageDecodeSessionV1> {
	if (typeof globalThis.createImageBitmap !== 'function') {
		throw new Error('This browser has no qualified native image decoder.');
	}
	const bitmap = await globalThis.createImageBitmap(new Blob([bytes.slice()], { type: mimeType }), {
		imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default',
	});
	// The bitmap exists before anything can reject, and only the returned session
	// can close it, so a cancellation landing in this window would orphan a raster
	// of up to the admitted maximum with no deterministic release. The decoder
	// branch above guards the same way.
	let width: number;
	let height: number;
	try {
		cancelled(signal);
		width = positiveInteger(bitmap.width, 'ImageBitmap width');
		height = positiveInteger(bitmap.height, 'ImageBitmap height');
	} catch (error) {
		bitmap.close();
		throw error;
	}
	let closed = false;
	return Object.freeze({
		metadata: Object.freeze({
			width, height, frameCount: 1, topology: 'single' as const,
			runtimeVersion: 'create-image-bitmap-v1',
		}),
		async decodeFrame(index: number, frameSignal?: AbortSignal) {
			if (closed) throw new Error('The browser image bitmap is closed.');
			if (index !== 0) throw new RangeError('A static browser image has one frame.');
			cancelled(frameSignal ?? signal);
			return Object.freeze({ rgba: drawRgba(bitmap, width, height), durationMicroseconds: null });
		},
		close() { if (!closed) { closed = true; bitmap.close(); } },
	});
}

function drawRgba(image: CanvasImageSource, width: number, height: number): Uint8Array {
	const canvas = createCanvas(width, height);
	const context = canvas.getContext('2d', {
		alpha: true, willReadFrequently: true, colorSpace: 'srgb',
	}) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
	if (!context) throw new Error('Browser-native image decode has no sRGB 2D canvas.');
	context.clearRect(0, 0, width, height);
	context.drawImage(image, 0, 0, width, height);
	return new Uint8Array(context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data);
}

function createCanvas(width: number, height: number): BrowserCanvas {
	if (typeof globalThis.OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
	if (!globalThis.document?.createElement) throw new Error('Browser-native image decode has no canvas runtime.');
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = width; canvas.height = height;
	return canvas;
}

function assertFrameDimensions(image: BrowserDecodedImageLike, width: number, height: number): void {
	const displayWidth = positiveInteger(image.displayWidth, 'decoded image display width');
	const displayHeight = positiveInteger(image.displayHeight, 'decoded image display height');
	if (displayWidth !== width || displayHeight !== height) {
		throw new RangeError('Decoded animation frames must share one oriented canvas.');
	}
}

async function supported(Decoder: BrowserImageDecoderConstructor, mimeType: string): Promise<boolean> {
	return typeof Decoder.isTypeSupported !== 'function' || await Decoder.isTypeSupported(mimeType);
}

function imageDecoderConstructor(): BrowserImageDecoderConstructor | null {
	const candidate = (globalThis as typeof globalThis & { ImageDecoder?: unknown }).ImageDecoder;
	return typeof candidate === 'function' ? candidate as BrowserImageDecoderConstructor : null;
}

function normalizedDuration(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function cancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Image decode was cancelled.', 'AbortError');
}
