/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';

const LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 });
const PROFILES = Object.freeze([Object.freeze({ sampleFormat: 'unorm8', primaries: 'display-p3', transfer: 'srgb' })]);
const NativeBytes = Uint8Array, NativeClamped = Uint8ClampedArray;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const FILL = NativeBytes.prototype.fill;
const PRIMARY = Object.freeze([255, 0, 0, 255, 0, 255, 0, 255]);
const CONVERTED_PRIMARY = Object.freeze([234, 51, 35, 255, 117, 251, 76, 255]);

/** Synchronous, bounded native proof; declarations alone never grant P3 authority.
 * Every call qualifies the current realm and retires its two-pixel canvas and
 * all JS inputs/readbacks. Unsupported platforms refuse without relabeling. */
export function qualifyPixelFrameDisplayP3CurrentV1(): void { qualify(captureNative()); }

/** Paint already encoded P3 without a second source backing. The caller retains
 * its borrowed pixels; successful native canvas backing belongs to its presenter. */
export function paintPixelFrameDisplayP3CurrentV1(frameValue: unknown, canvas: HTMLCanvasElement): Readonly<{ width: number; height: number; byteLength: number }> {
	const input = record(frameValue, 'P3 canvas frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'P3 canvas frame'), { profiles: PROFILES, limits: LIMITS });
	const native = captureNative(); qualify(native);
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'P3 canvas frame') }, LIMITS);
	const span = pixelSpan(frame.pixels), owner = new Pixels(span.backing), target = geometry(native, canvas), failures: unknown[] = [];
	try {
		clear(target, failures); throwFailures(failures);
		const context = contextFor(native, canvas);
		const pixels = new NativeClamped(span.backing, span.offset, span.length);
		const image = new native.Image(pixels, plan.descriptor.width, plan.descriptor.height, { colorSpace: 'display-p3' });
		imageSpan(native, image, plan.descriptor.width, plan.descriptor.height, 'display-p3', owner, pixels);
		target.resize(plan.descriptor.width, plan.descriptor.height);
		Reflect.apply(native.put, context, [image, 0, 0]);
	} catch (error) { append(failures, error); }
	owner.retire(failures);
	if (failures.length) { clear(target, failures); throwFailures(failures); }
	return Object.freeze({ width: plan.descriptor.width, height: plan.descriptor.height, byteLength: plan.byteLength });
}

function captureNative() {
	if (typeof HTMLCanvasElement === 'undefined' || typeof CanvasRenderingContext2D === 'undefined'
		|| typeof ImageData === 'undefined' || typeof Document === 'undefined' || typeof document === 'undefined') {
		throw new RangeError('Native Display P3 canvas presentation is unavailable.');
	}
	const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
	const height = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
	const data = Object.getOwnPropertyDescriptor(ImageData.prototype, 'data')?.get;
	const imageWidth = Object.getOwnPropertyDescriptor(ImageData.prototype, 'width')?.get;
	const imageHeight = Object.getOwnPropertyDescriptor(ImageData.prototype, 'height')?.get;
	const colorSpace = Object.getOwnPropertyDescriptor(ImageData.prototype, 'colorSpace')?.get;
	const get = HTMLCanvasElement.prototype.getContext, attributes = CanvasRenderingContext2D.prototype.getContextAttributes;
	const put = CanvasRenderingContext2D.prototype.putImageData, read = CanvasRenderingContext2D.prototype.getImageData;
	const create = Document.prototype.createElement;
	if (!width?.get || !width.set || !height?.get || !height.set || !data || !imageWidth || !imageHeight || !colorSpace
		|| typeof get !== 'function' || typeof attributes !== 'function' || typeof put !== 'function' || typeof read !== 'function' || typeof create !== 'function') {
		throw new RangeError('Qualified native Display P3 canvas ownership is unavailable.');
	}
	return { widthGet: width.get, widthSet: width.set, heightGet: height.get, heightSet: height.set,
		data, imageWidth, imageHeight, colorSpace, get, attributes, put, read, create, document, Image: ImageData };
}
type Native = ReturnType<typeof captureNative>;

function geometry(native: Native, canvas: HTMLCanvasElement) {
	// Native accessors prove the receiver and bypass caller-owned geometry shadows.
	const width: unknown = Reflect.apply(native.widthGet, canvas, []), height: unknown = Reflect.apply(native.heightGet, canvas, []);
	if (typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) {
		throw new TypeError('P3 canvas requires a native geometry receiver.');
	}
	return {
		width: (value: number) => { Reflect.apply(native.widthSet, canvas, [value]); },
		height: (value: number) => { Reflect.apply(native.heightSet, canvas, [value]); },
		resize: (x: number, y: number) => { Reflect.apply(native.widthSet, canvas, [x]); Reflect.apply(native.heightSet, canvas, [y]); },
	};
}
type Geometry = ReturnType<typeof geometry>;

function contextFor(native: Native, canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const context = Reflect.apply(native.get, canvas, ['2d', { colorSpace: 'display-p3', alpha: true }]) as CanvasRenderingContext2D | null;
	if (!context) throw new RangeError('A native Display P3 2D context is unavailable.');
	const attributes = record(Reflect.apply(native.attributes, context, []), 'P3 context attributes',
		['alpha', 'colorSpace', 'colorType', 'desynchronized', 'willReadFrequently', 'toneMapping'], ['alpha', 'colorSpace']);
	if (field(attributes, 'alpha', 'P3 context attributes') !== true || field(attributes, 'colorSpace', 'P3 context attributes') !== 'display-p3') {
		throw new RangeError('Native canvas must declare Display P3 and transparent alpha.');
	}
	return context;
}

function qualify(native: Native): void {
	const canvas = Reflect.apply(native.create, native.document, ['canvas']) as HTMLCanvasElement;
	const target = geometry(native, canvas), owner = new Pixels(), failures: unknown[] = [];
	try {
		clear(target, failures); throwFailures(failures);
		const context = contextFor(native, canvas); target.resize(2, 1);
		for (const profile of ['display-p3', 'srgb'] as const) {
			const pixels = owner.allocate(8); pixels.set(PRIMARY);
			const image = new native.Image(pixels, 2, 1, { colorSpace: profile });
			imageSpan(native, image, 2, 1, profile, owner, pixels);
			Reflect.apply(native.put, context, [image, 0, 0]);
			const readback = Reflect.apply(native.read, context, [0, 0, 2, 1, { colorSpace: 'display-p3' }]) as ImageData;
			const read = imageSpan(native, readback, 2, 1, 'display-p3', owner);
			const expected = profile === 'display-p3' ? PRIMARY : CONVERTED_PRIMARY;
			for (let index = 0; index < 8; index++) {
				const tolerance = profile === 'srgb' && index % 4 !== 3 ? 1 : 0;
				if (Math.abs(read[index]! - expected[index]!) > tolerance) throw new RangeError('Native Display P3 primary retention or color conversion failed qualification.');
			}
		}
	} catch (error) { append(failures, error); }
	owner.retire(failures); clear(target, failures); throwFailures(failures);
}

function imageSpan(native: Native, image: ImageData, width: number, height: number, profile: PredefinedColorSpace,
	owner: Pixels, alias?: Uint8ClampedArray<ArrayBuffer>): Uint8ClampedArray<ArrayBuffer> {
	const data: unknown = Reflect.apply(native.data, image, []);
	if (!data || Object.getPrototypeOf(data) !== NativeClamped.prototype) throw new TypeError('P3 ImageData requires native byte pixels.');
	const span = pixelSpan(data); owner.capture(span.backing);
	if (Reflect.apply(native.imageWidth, image, []) !== width || Reflect.apply(native.imageHeight, image, []) !== height
		|| Reflect.apply(native.colorSpace, image, []) !== profile || span.length !== width * height * 4) {
		throw new RangeError('Native ImageData must retain its exact extent and declared color space.');
	}
	if (alias) {
		const source = pixelSpan(alias);
		if (source.backing !== span.backing || source.offset !== span.offset || source.length !== span.length) throw new RangeError('Native ImageData must alias its provided pixel backing.');
	}
	return new NativeClamped(span.backing, span.offset, span.length);
}

function pixelSpan(value: unknown): Readonly<{ backing: ArrayBuffer; offset: number; length: number }> {
	const backing: unknown = Reflect.apply(BUFFER, value, []);
	if (!(backing instanceof ArrayBuffer) || RESIZABLE && Reflect.apply(RESIZABLE, backing, []) === true) throw new TypeError('P3 pixel storage requires a fixed ArrayBuffer.');
	const offset = Reflect.apply(OFFSET, value, []) as number, length = Reflect.apply(LENGTH, value, []) as number;
	// Constructing the pinned span also refuses a detached native backing.
	new NativeBytes(backing, offset, length);
	return { backing, offset, length };
}

class Pixels {
	readonly #owned = new Map<ArrayBuffer, number>();
	constructor(readonly borrowed?: ArrayBuffer) {}
	allocate(length: number): Uint8ClampedArray<ArrayBuffer> {
		const pixels = new NativeClamped(length); this.capture(pixels.buffer); return pixels;
	}
	capture(backing: ArrayBuffer): void {
		if (backing !== this.borrowed && !this.#owned.has(backing)) this.#owned.set(backing, Reflect.apply(SIZE, backing, []) as number);
	}
	retire(failures: unknown[]): void {
		for (const [backing, size] of this.#owned) {
			try {
				if (Reflect.apply(SIZE, backing, []) !== size) throw new TypeError('P3 presentation owned pixel backing was detached.');
				Reflect.apply(FILL, new NativeBytes(backing, 0, size), [0]);
			} catch (error) { append(failures, error); }
		}
		this.#owned.clear();
	}
}

function clear(target: Geometry, failures: unknown[]): void {
	try { target.width(0); } catch (error) { append(failures, error); }
	try { target.height(0); } catch (error) { append(failures, error); }
}
function append(failures: unknown[], error: unknown): void { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
function throwFailures(failures: readonly unknown[]): void {
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Display P3 presentation and retirement failed.', { cause: failures[0] });
}
