/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { captureImageExportTextV1 } from '../image-export-text-v1.ts';
import { imageExportGraphicPlacement } from '../image-export-graphic-request.ts';
import { readPixelFrameV1, type PixelFrameV1, type PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import { withImageExportTextFontV1, assertImageExportTextSignalV1, wipeImageExportTextBytesV1, IMAGE_EXPORT_TEXT_FONT_V1, type ImageExportTextFontPortV1 } from './image-export-text-font-v1.ts';

export interface ImageExportTextCanvasV1 {
	measure(text: string, family: string): Readonly<{ left: number; right: number; ascent: number; descent: number }>;
	draw(text: string, family: string, color: string, geometry: Readonly<{ width: number; height: number; scale: number; x: number; y: number }>): Uint8ClampedArray<ArrayBuffer>;
	close(): void | Promise<void>;
}
const LIMITS = Object.freeze({ maximumSidePixels: 4096, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const MAXIMUM_WORKING_BYTES = 268_435_456, CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const yieldTask = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

/** One readable, real native glyph plane in encoded sRGB. Font and canvas
 * owners finish before the independent plane is lent to the awaited consumer;
 * that plane is erased only after consumer/codec settlement. The working cap
 * charges font bytes and both JS mask planes; native face/canvas memory is
 * separately owned and canvas geometry is bounded. Default/zero opacity does
 * no resource I/O or allocation. Placement and blending retain their shared
 * owners; this module never interprets a project, recipe or output profile. */
export async function withImageExportTextFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<PixelFrameV1> | null) => Result | Promise<Result>,
	optionsValue: Readonly<{ font?: ImageExportTextFontPortV1; createCanvas?: () => ImageExportTextCanvasV1; maximumWorkingBytes?: number }> = {}): Promise<Result> {
	const input = record(value, 'export text frame', ['text', 'width', 'height', 'signal'], ['width', 'height']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'export text frame') as AbortSignal : undefined;
	if (signal !== undefined) assertImageExportTextSignalV1(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	if (typeof consume !== 'function') throw new TypeError('Export text requires a scoped glyph consumer.');
	const rawText = Object.hasOwn(input, 'text') ? field(input, 'text', 'export text frame') : undefined;
	const text = rawText === undefined ? undefined : captureImageExportTextV1(rawText);
	if (!text || text.opacity === 0) { const result = await consume(null); check(); return result; }
	const width = dimension(field(input, 'width', 'export text frame')), height = dimension(field(input, 'height', 'export text frame'));
	const placement = imageExportGraphicPlacement(text, width, height);
	const options = record(optionsValue, 'export text frame options', ['font', 'createCanvas', 'maximumWorkingBytes'], []);
	const maximum = Object.hasOwn(options, 'maximumWorkingBytes') ? field(options, 'maximumWorkingBytes', 'export text frame options') : MAXIMUM_WORKING_BYTES;
	if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAXIMUM_WORKING_BYTES) throw new RangeError('Export text working capacity is invalid.');
	if (maximum <= IMAGE_EXPORT_TEXT_FONT_V1.byteLength) throw new RangeError('Export text working capacity cannot hold a glyph plane.');
	const font = Object.hasOwn(options, 'font') ? field(options, 'font', 'export text frame options') as ImageExportTextFontPortV1 : undefined;
	const createCanvas = Object.hasOwn(options, 'createCanvas') ? field(options, 'createCanvas', 'export text frame options') as () => ImageExportTextCanvasV1 : nativeCanvasFactory();
	if (typeof createCanvas !== 'function') throw new TypeError('Export text requires a native glyph canvas.');
	let pixels: Uint8Array<ArrayBuffer> | undefined, descriptor: Readonly<PixelFrameDescriptorV1> | undefined;
	try {
		await withImageExportTextFontV1(async family => {
			let close: (() => void | Promise<void>) | undefined, nativePixels: Uint8ClampedArray<ArrayBuffer> | undefined;
			let primary: { reason: unknown } | undefined, cleanup: { reason: unknown } | undefined;
			try {
				check(); const canvas = createCanvas(); close = capture(canvas, 'close');
				const measure = capture(canvas, 'measure'), draw = capture(canvas, 'draw');
				const metrics = measure(text.text, family), inkWidth = metrics.left + metrics.right, inkHeight = metrics.ascent + metrics.descent;
				if (![metrics.left, metrics.right, metrics.ascent, metrics.descent, inkWidth, inkHeight].every(Number.isFinite) || inkWidth <= 0 || inkHeight <= 0) throw new RangeError('Export text glyph metrics are invalid.');
				const targetWidth = Math.max(1, Math.round((width - 2 * placement.marginPixels) * text.widthFraction));
				const scale = Math.min(targetWidth / inkWidth, (height - 2 * placement.marginPixels) / inkHeight);
				const maskWidth = Math.max(1, Math.ceil(inkWidth * scale)), maskHeight = Math.max(1, Math.ceil(inkHeight * scale));
				if (maskWidth > LIMITS.maximumSidePixels || maskHeight > LIMITS.maximumSidePixels || maskWidth * maskHeight > LIMITS.maximumPixels
					|| IMAGE_EXPORT_TEXT_FONT_V1.byteLength + maskWidth * maskHeight * 8 > maximum) throw new RangeError('Export text glyph planes exceed their working capacity.');
				nativePixels = draw(text.text, family, text.color, { width: maskWidth, height: maskHeight, scale, x: metrics.left * scale, y: metrics.ascent * scale }); check();
				descriptor = Object.freeze({ schemaVersion: 1 as const, width: maskWidth, height: maskHeight, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
				readPixelFrameV1({ descriptor, pixels: nativePixels }, LIMITS);
				pixels = new Uint8Array(maskWidth * maskHeight * 4);
				for (let start = 0; start < pixels.length; start += 65_536) {
					check(); const end = Math.min(pixels.length, start + 65_536); pixels.set(nativePixels.subarray(start, end), start);
					for (let offset = start; offset < end; offset += 4) if (pixels[offset + 3] === 0) pixels.fill(0, offset, offset + 3);
					if (end < pixels.length) { await yieldTask(); check(); }
				}
			} catch (error) { primary = { reason: error }; }
			try { await close?.(); } catch (error) { cleanup = { reason: error }; }
			wipeImageExportTextBytesV1(nativePixels);
			if (primary && cleanup) throw new AggregateError([primary.reason, cleanup.reason], 'Export text drawing and canvas cleanup failed.', { cause: primary.reason });
			if (primary) throw primary.reason; if (cleanup) throw cleanup.reason;
		}, { signal, port: font });
		check(); if (!pixels || !descriptor) throw new Error('Export text did not produce a glyph plane.');
		const result = await consume(readPixelFrameV1({ descriptor, pixels }, LIMITS)); check();
		if (Number(Reflect.apply(BUFFER_SIZE, pixels.buffer, [])) === 0) throw new RangeError('Export text glyph plane was detached.');
		return result;
	} finally { wipeImageExportTextBytesV1(pixels); }
}

function nativeCanvasFactory(): () => ImageExportTextCanvasV1 {
	const Offscreen = globalThis.OffscreenCanvas, document = globalThis.document;
	if (typeof Offscreen !== 'function' && !document) throw new Error('Native export text canvas is unavailable.');
	const create = typeof Offscreen === 'function' ? undefined : document!.createElement.bind(document);
	return () => {
		const canvas = typeof Offscreen === 'function' ? new Offscreen(1, 1) : create!('canvas');
		let closed = false;
		const close = () => {
			if (closed) return; closed = true;
			const failures: unknown[] = [];
			for (const key of ['width', 'height'] as const) { try { canvas[key] = 0; } catch (error) { failures.push(error); } }
			if (failures.length > 1) throw new AggregateError(failures, 'Export text canvas cleanup failed.');
			if (failures.length) throw failures[0];
		};
		try {
			const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
			if (!context) throw new Error('Native export text drawing is unavailable.');
			const measure = context.measureText.bind(context), fill = context.fillText.bind(context), read = context.getImageData.bind(context);
			return {
				measure(text, family) { context.font = `600 128px "${family}"`; context.textBaseline = 'alphabetic'; context.textAlign = 'left';
					const metrics = measure(text); return { left: metrics.actualBoundingBoxLeft, right: metrics.actualBoundingBoxRight, ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent }; },
				draw(text, family, color, geometry) {
					canvas.width = geometry.width; canvas.height = geometry.height;
					context.font = `600 ${128 * geometry.scale}px "${family}"`; context.fillStyle = color; context.textBaseline = 'alphabetic'; context.textAlign = 'left';
					fill(text, geometry.x, geometry.y); return read(0, 0, geometry.width, geometry.height).data as Uint8ClampedArray<ArrayBuffer>;
				}, close,
			};
		} catch (error) {
			const failures: unknown[] = [];
			try { close(); }
			catch (cleanup) { failures.push(cleanup); }
			if (failures.length) throw new AggregateError([error, ...failures], 'Export text canvas acquisition and cleanup failed.', { cause: error });
			throw error;
		}
	};
}
function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65_536) throw new RangeError('Export text delivery dimensions are invalid.');
	return value;
}
function capture<Key extends keyof ImageExportTextCanvasV1>(canvas: ImageExportTextCanvasV1, key: Key): ImageExportTextCanvasV1[Key] {
	let owner: object | null = canvas;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Export text canvas requires a data capability.');
			const method = descriptor.value as (...args: unknown[]) => unknown;
			return ((...args: unknown[]) => Reflect.apply(method, canvas, args) as unknown) as ImageExportTextCanvasV1[Key];
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('Export text canvas capability is unavailable.');
}
