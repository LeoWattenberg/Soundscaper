/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';

const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;

/** Paint admitted, already oriented pixels without conversion or a second JS pixel backing. */
export function paintPixelFrameCanvasV1(canvas: HTMLCanvasElement, frameValue: PixelFrameV1,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1; signal?: AbortSignal }>) {
	const options = record(optionsValue, 'pixel canvas options', ['limits', 'signal'], ['limits']);
	const limits = record(field(options, 'limits', 'pixel canvas options'), 'pixel canvas limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const input = record(frameValue, 'pixel canvas frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'pixel canvas frame'), { limits });
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'pixel canvas frame') }, limits);
	const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'pixel canvas options') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Pixel canvas requires a native cancellation signal.');
	const check = () => { if (signal) Reflect.apply(ABORT_CHECK, signal, []); };
	check();
	const geometry = canvasGeometry(canvas);
	try {
		geometry.clear();
		if (typeof ImageData === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') throw new RangeError('Native RGBA canvas presentation is unavailable.');
		const context = Reflect.apply(HTMLCanvasElement.prototype.getContext, canvas, ['2d', { alpha: true, colorSpace: 'srgb' }]) as CanvasRenderingContext2D | null;
		if (!context || typeof CanvasRenderingContext2D.prototype.getContextAttributes !== 'function') throw new RangeError('A qualified native RGBA canvas context is unavailable.');
		const attributes = Reflect.apply(CanvasRenderingContext2D.prototype.getContextAttributes, context, []) as CanvasRenderingContext2DSettings;
		if (attributes.alpha !== true || attributes.colorSpace !== 'srgb') {
			if (Object.hasOwn(attributes, 'alpha') || Object.hasOwn(attributes, 'colorSpace')) throw new RangeError('Pixel canvas requires straight-alpha encoded sRGB presentation.');
			qualifyLegacyContext(canvas, context, geometry, check);
		}
		const view = new Uint8ClampedArray(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
		const image = new ImageData(view, plan.descriptor.width, plan.descriptor.height, { colorSpace: 'srgb' });
		if (image.data.buffer !== view.buffer || image.data.byteOffset !== view.byteOffset || image.data.byteLength !== view.byteLength) throw new RangeError('Native ImageData must alias the admitted pixel backing.');
		check();
		geometry.resize(plan.descriptor.width, plan.descriptor.height);
		check();
		Reflect.apply(CanvasRenderingContext2D.prototype.putImageData, context, [image, 0, 0]);
		check();
		return Object.freeze({ byteLength: plan.byteLength, width: plan.descriptor.width, height: plan.descriptor.height });
	} catch (error) {
		try { geometry.clear(); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Pixel canvas presentation and backing cleanup failed.', { cause: cleanup }); }
		throw error;
	}
}

/** Release the backing on replacement, detachment or owner cleanup. */
export function clearPixelFrameCanvasV1(canvas: HTMLCanvasElement): void { canvasGeometry(canvas).clear(); }

/** Missing declarations qualify only when native creation ignores the newer color-space member. */
function qualifyLegacyContext(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, target: ReturnType<typeof canvasGeometry>, check: () => void): void {
	const clearRect = CanvasRenderingContext2D.prototype.clearRect;
	if (typeof Node === 'undefined' || typeof Document === 'undefined' || typeof clearRect !== 'function' || typeof CanvasRenderingContext2D.prototype.getImageData !== 'function') throw new RangeError('Legacy default-sRGB canvas qualification is unavailable.');
	const owner = Object.getOwnPropertyDescriptor(Node.prototype, 'ownerDocument')?.get;
	if (!owner) throw new RangeError('Legacy default-sRGB canvas ownership is unavailable.');
	const document = Reflect.apply(owner, canvas, []) as Document;
	const probe = Reflect.apply(Document.prototype.createElement, document, ['canvas']) as HTMLCanvasElement;
	const scratch = canvasGeometry(probe);
	let pixels: Uint8ClampedArray | undefined;
	try {
		scratch.clear(); check();
		let observed = false;
		const settings = { alpha: true, get colorSpace() { observed = true; return 'srgb'; } };
		const fresh = Reflect.apply(HTMLCanvasElement.prototype.getContext, probe, ['2d', settings]) as CanvasRenderingContext2D | null;
		if (!fresh || observed) throw new RangeError('Missing native canvas color-space declarations are ambiguous.');
		check();
		// Force backing initialization before observing alpha on a legacy context.
		// The sole nonzero probe backing and its read buffer are four bytes each.
		target.resize(1, 1);
		Reflect.apply(clearRect, context, [0, 0, 1, 1]);
		pixels = (Reflect.apply(CanvasRenderingContext2D.prototype.getImageData, context, [0, 0, 1, 1]) as ImageData).data;
		if (!(pixels instanceof Uint8ClampedArray) || pixels.byteLength !== 4 || pixels[3] !== 0) throw new RangeError('Legacy pixel canvas requires qualified transparent alpha.');
		check();
	} finally {
		if (pixels) new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength).fill(0);
		try { scratch.clear(); } finally { target.clear(); }
	}
}

function canvasGeometry(canvas: HTMLCanvasElement) {
	if (typeof HTMLCanvasElement === 'undefined') throw new RangeError('Native canvas presentation is unavailable.');
	const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
	const height = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
	if (!width?.get || !width.set || !height?.get || !height.set) throw new RangeError('Native canvas backing ownership is unavailable.');
	// Native getters prove the receiver without evaluating shadowed own fields.
	Reflect.apply(width.get, canvas, []); Reflect.apply(height.get, canvas, []);
	const resize = (x: number, y: number) => { Reflect.apply(width.set!, canvas, [x]); Reflect.apply(height.set!, canvas, [y]); };
	return { resize, clear: () => { resize(0, 0); } };
}
