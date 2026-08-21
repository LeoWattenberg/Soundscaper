/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserCaptureTrack } from './framescaper-browser-capture-source.ts';
import { mapWebVcrCropToEvenFramePixels } from '../web-vcr-geometry.ts';
import type { WebVcrDimensions, WebVcrNormalizedCrop } from '../web-vcr-domain.ts';

interface WebVcrInputVideoFrame {
	readonly codedWidth: number;
	readonly codedHeight: number;
	readonly timestamp: number;
	readonly duration?: number | null;
	close(): void;
}

type WebVcrOutputVideoFrame = WebVcrInputVideoFrame;

interface WebVcrFrameReader {
	read(): Promise<Readonly<{ readonly done: boolean; readonly value?: WebVcrInputVideoFrame }>>;
	cancel(reason?: unknown): PromiseLike<void> | void;
	releaseLock(): void;
}

interface WebVcrFrameWriter {
	write(frame: WebVcrOutputVideoFrame): PromiseLike<void> | void;
	close(): PromiseLike<void> | void;
	abort(reason?: unknown): PromiseLike<void> | void;
	releaseLock(): void;
}

interface WebVcrTrackProcessor {
	readonly readable: Readonly<{ getReader(): WebVcrFrameReader }>;
}

interface WebVcrTrackGenerator extends BrowserCaptureTrack {
	readonly writable: Readonly<{ getWriter(): WebVcrFrameWriter }>;
}

export interface WebVcrVideoFrameCropRuntime {
	readonly MediaStreamTrackProcessor: new (
		options: Readonly<{ readonly track: BrowserCaptureTrack }>,
	) => WebVcrTrackProcessor;
	readonly MediaStreamTrackGenerator: new (
		options: Readonly<{ readonly kind: 'video' }>,
	) => WebVcrTrackGenerator;
	readonly VideoFrame: new (
		source: WebVcrInputVideoFrame,
		options: Readonly<{
			readonly visibleRect: Readonly<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }>;
			readonly displayWidth: number;
			readonly displayHeight: number;
			readonly timestamp: number;
			readonly duration?: number;
		}>,
	) => WebVcrOutputVideoFrame;
}

export interface WebVcrCroppedVideoTrack {
	readonly track: BrowserCaptureTrack;
	readonly firstFrame: Promise<Readonly<{
		readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions>;
	}>>;
	dispose(reason?: unknown): Promise<void>;
}

/** Crops every frame before the 8A encoder and refuses surface-size drift. */
export function createWebVcrCroppedVideoTrack(options: Readonly<{
	readonly source: BrowserCaptureTrack;
	readonly crop: Readonly<WebVcrNormalizedCrop>;
	readonly runtime: WebVcrVideoFrameCropRuntime;
	onError(error: unknown): void;
}>): Readonly<WebVcrCroppedVideoTrack> {
	const processor = new options.runtime.MediaStreamTrackProcessor({ track: options.source });
	const generator = new options.runtime.MediaStreamTrackGenerator({ kind: 'video' });
	const reader = processor.readable.getReader();
	const writer = generator.writable.getWriter();
	const controller = new AbortController();
	let disposePromise: Promise<void> | null = null;
	let resolveFirst!: (value: Readonly<{
		readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions>;
	}>) => void;
	let rejectFirst!: (reason: unknown) => void;
	const firstFrame = new Promise<Readonly<{
		readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions>;
	}>>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
	let firstSize: Readonly<WebVcrDimensions> | null = null;
	let firstSettled = false;
	const pump = pumpFrames().catch((error: unknown) => {
		if (!firstSettled) { firstSettled = true; rejectFirst(error); }
		if (!controller.signal.aborted) {
			try { options.onError(error); } catch { /* Failure observers cannot own the crop pump. */ }
		}
	});

	return Object.freeze({
		track: generator,
		firstFrame,
		dispose(reason = new DOMException('Web VCR crop pipeline disposed.', 'AbortError')) {
			disposePromise ??= disposePipeline(reason);
			return disposePromise;
		},
	});

	async function pumpFrames(): Promise<void> {
		while (!controller.signal.aborted) {
			const result = await reader.read();
			if (result.done) break;
			const frame = result.value;
			if (!frame) throw new Error('Web VCR crop processor returned an empty frame.');
			let output: WebVcrOutputVideoFrame | null = null;
			try {
				const inputSize = Object.freeze({ width: frame.codedWidth, height: frame.codedHeight });
				if (!firstSize) firstSize = inputSize;
				else if (firstSize.width !== inputSize.width || firstSize.height !== inputSize.height) {
					throw new Error('Web VCR capture surface dimensions changed during recording.');
				}
				const frozen = mapWebVcrCropToEvenFramePixels(options.crop, firstSize);
				output = new options.runtime.VideoFrame(frame, {
					visibleRect: frozen.pixelCrop,
					displayWidth: frozen.pixelCrop.width,
					displayHeight: frozen.pixelCrop.height,
					timestamp: frame.timestamp,
					...(frame.duration === null || frame.duration === undefined ? {} : { duration: frame.duration }),
				});
				await writer.write(output);
				if (!firstSettled) {
					firstSettled = true;
					resolveFirst(Object.freeze({
						inputSize: firstSize,
						outputSize: Object.freeze({
							width: frozen.pixelCrop.width, height: frozen.pixelCrop.height,
						}),
					}));
				}
			} finally {
				try { output?.close(); } catch { /* A failed writer may already close the frame. */ }
				try { frame.close(); } catch { /* A revoked processor may already close the frame. */ }
			}
		}
		await writer.close();
		if (!firstSettled) throw new Error('Web VCR video ended before the first captured frame.');
	}

	async function disposePipeline(reason: unknown): Promise<void> {
		controller.abort(reason);
		await Promise.allSettled([
			Promise.resolve(reader.cancel(reason)),
			Promise.resolve(writer.abort(reason)),
		]);
		await pump;
		try { generator.stop(); } catch { /* Generator teardown is idempotent. */ }
		try { reader.releaseLock(); } catch { /* The stream may already be detached. */ }
		try { writer.releaseLock(); } catch { /* The stream may already be detached. */ }
	}
}
