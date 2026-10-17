/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { decodeManagedSdrOutputPixelV1 } from '../video-color-management-v27.ts';
import { createManagedSdrLinearByteEncoderV1 } from '../video-color-byte-encoding.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { planImageExportSizeV1 } from './image-export-size-v1.ts';
import { withExportResizedPixelFrameV1 } from './pixel-frame-export-resize-v1.ts';
import type { GeometryPixelFrameV1 } from './pixel-frame-geometry-v1.ts';
import { compositeLinearPremultipliedRgbaSpanV1 } from './linear-rgba-composite-v1.ts';

export interface GraphicWatermarkPlacementV1 {
	readonly anchor: 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'middle-center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
	readonly widthFraction: number; readonly marginPixels: number; readonly opacity: number;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const GRAPHIC_PROFILES = Object.freeze([Object.freeze({ sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const })]);
const SOURCE_PROFILES = Object.freeze([...GRAPHIC_PROFILES,
	Object.freeze({ sampleFormat: 'unorm8' as const, primaries: 'bt709' as const, transfer: 'bt709' as const })]);
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const COPY_BYTES = 65_536, TILE_PIXELS = 1024, MAXIMUM_WORKING_BYTES = 268_435_456;
const yieldTask = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

/** Output-only normal blending in linear light, using the same span as Frame
 * exact composition. Source pixels are encoded sRGB or Rec.709; the graphic
 * is strictly sRGB. Only the graphic is resampled; pixels with no graphic
 * coverage keep their exact bytes, including hidden RGB. The independently
 * owned output, resized graphic, lookup and bounded Float64 tiles share one
 * captured working-byte ceiling. Borrowed source/graphic frames are admitted
 * separately; this does not bound a native decoder's memory. The callback
 * borrows output through settlement, then all owned workspace is wiped.
 * Explicit opacity zero still returns a copy; an unused UI option can bypass
 * this helper entirely. No project, original or develop state is mutated. */
export async function withGraphicWatermarkPixelFrameV1<Result>(value: unknown,
	consume: (frame: GeometryPixelFrameV1) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1; maximumWorkingBytes: number }>): Promise<Result> {
	const input = record(value, 'graphic watermark request', ['frame', 'graphic', 'placement', 'signal'], ['frame', 'graphic', 'placement']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'graphic watermark request') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Graphic watermark requires a scoped pixel consumer.');
	const options = record(optionsValue, 'graphic watermark options', ['limits', 'maximumWorkingBytes']);
	const rawLimits = record(field(options, 'limits', 'graphic watermark options'), 'graphic watermark limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const limit = (key: string) => integer(field(rawLimits, key, 'graphic watermark limits'), 1, Number.MAX_SAFE_INTEGER, 'Graphic watermark frame capacity');
	const limits = Object.freeze({ maximumSidePixels: limit('maximumSidePixels'), maximumPixels: limit('maximumPixels'), maximumBytes: limit('maximumBytes') });
	const maximumWorkingBytes = integer(field(options, 'maximumWorkingBytes', 'graphic watermark options'), 1, MAXIMUM_WORKING_BYTES, 'Graphic watermark working capacity');
	const source = captureFrame(field(input, 'frame', 'graphic watermark request'), limits, true);
	const graphic = captureFrame(field(input, 'graphic', 'graphic watermark request'), limits);
	const outputSpace = source.descriptor.transfer === 'bt709' ? 'rec709' : 'srgb';
	const place = capturePlacement(field(input, 'placement', 'graphic watermark request'), source.descriptor.width, source.descriptor.height);
	const sizing = Object.freeze({ kind: 'fit' as const, width: Math.max(1, Math.round((source.descriptor.width - 2 * place.marginPixels) * place.widthFraction)),
		height: source.descriptor.height - 2 * place.marginPixels, allowUpscale: true });
	const plan = planImageExportSizeV1(graphic.descriptor, sizing, limits), tilePixels = Math.min(TILE_PIXELS, plan.pixelCount);
	const scratchBytes = place.opacity === 0 ? 0 : plan.byteLength + tilePixels * 4 * 8 * 2 + 256 * 8 * (outputSpace === 'srgb' ? 1 : 2);
	if (source.pixels.byteLength + scratchBytes > maximumWorkingBytes) throw new RangeError('Graphic watermark working capacity is exceeded.');
	const checkSource = () => {
		check(); for (const buffer of [source.pixels.buffer, graphic.pixels.buffer]) {
			if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) === 0) throw new RangeError('Graphic watermark borrowed buffer was detached.');
		}
	};
	checkSource();
	const pixels = new Uint8Array(source.pixels.byteLength), outputBuffer = pixels.buffer;
	try {
		for (let start = 0; start < pixels.length; start += COPY_BYTES) {
			checkSource(); const end = Math.min(pixels.length, start + COPY_BYTES); pixels.set(source.pixels.subarray(start, end), start);
			if (end < pixels.length) { await yieldTask(); checkSource(); }
		}
		if (place.opacity !== 0) await withExportResizedPixelFrameV1({ frame: graphic, sizing, quality: 'bilinear', signal }, async resized => {
			let backdrop: Float64Array<ArrayBuffer> | null = null, foreground: Float64Array<ArrayBuffer> | null = null;
			let decoded: Float64Array<ArrayBuffer> | null = null, sourceDecoded: Float64Array<ArrayBuffer> | null = null;
			try {
				backdrop = new Float64Array(tilePixels * 4); foreground = new Float64Array(tilePixels * 4); decoded = new Float64Array(256);
				for (let byte = 0; byte < 256; byte++) decoded[byte] = decodeManagedSdrOutputPixelV1([byte / 255, byte / 255, byte / 255, 1], 'srgb')[0];
				sourceDecoded = outputSpace === 'srgb' ? decoded : new Float64Array(256);
				if (sourceDecoded !== decoded) for (let byte = 0; byte < 256; byte++) sourceDecoded[byte] = decodeManagedSdrOutputPixelV1([byte / 255, byte / 255, byte / 255, 1], outputSpace)[0];
				const encode = createManagedSdrLinearByteEncoderV1(outputSpace), width = resized.descriptor.width, height = resized.descriptor.height;
				const [vertical, horizontal] = place.anchor.split('-');
				const originX = position(horizontal!, source.descriptor.width, width, place.marginPixels), originY = position(vertical!, source.descriptor.height, height, place.marginPixels);
				for (let start = 0; start < plan.pixelCount; start += tilePixels) {
					checkSource(); const count = Math.min(tilePixels, plan.pixelCount - start);
					for (let index = 0; index < count; index++) {
						const pixel = start + index, mark = pixel * 4, target = ((originY + Math.floor(pixel / width)) * source.descriptor.width + originX + pixel % width) * 4;
						const alpha = pixels[target + 3]! / 255, graphicAlpha = resized.pixels[mark + 3]! / 255 * place.opacity, offset = index * 4;
						for (let channel = 0; channel < 3; channel++) { backdrop[offset + channel] = sourceDecoded[pixels[target + channel]!]! * alpha;
							foreground[offset + channel] = decoded[resized.pixels[mark + channel]!]! * graphicAlpha; }
						backdrop[offset + 3] = alpha; foreground[offset + 3] = graphicAlpha;
					}
					compositeLinearPremultipliedRgbaSpanV1(backdrop.subarray(0, count * 4), foreground.subarray(0, count * 4), 'normal');
					for (let index = 0; index < count; index++) {
						const offset = index * 4; if (foreground[offset + 3] === 0) continue;
						const pixel = start + index, target = ((originY + Math.floor(pixel / width)) * source.descriptor.width + originX + pixel % width) * 4, alpha = backdrop[offset + 3]!;
						for (let channel = 0; channel < 3; channel++) pixels[target + channel] = encode(alpha > 1e-12 ? Math.max(0, Math.min(1, backdrop[offset + channel]! / alpha)) : 0);
						pixels[target + 3] = Math.round(alpha * 255);
					}
					if (start + count < plan.pixelCount) { await yieldTask(); checkSource(); }
				}
			} finally { backdrop?.fill(0); foreground?.fill(0); decoded?.fill(0); if (sourceDecoded !== decoded) sourceDecoded?.fill(0); }
		}, { limits });
		checkSource(); const descriptor = Object.freeze({ ...source.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); checkSource();
		if (Number(Reflect.apply(BUFFER_SIZE, outputBuffer, [])) === 0) throw new RangeError('Graphic watermark output buffer was detached.');
		return result;
	} finally { if (Number(Reflect.apply(BUFFER_SIZE, outputBuffer, [])) > 0) new Uint8Array(outputBuffer).fill(0); }
}

function captureFrame(value: unknown, limits: PixelFrameLimitsV1, source = false): GeometryPixelFrameV1 {
	const input = record(value, 'graphic watermark frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'graphic watermark frame'), { limits, profiles: source ? SOURCE_PROFILES : GRAPHIC_PROFILES });
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'graphic watermark frame') }, limits);
	if (frame.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Graphic watermark requires UNORM8 encoded SDR.');
	return Object.freeze({ descriptor: Object.freeze({ ...frame.descriptor, sampleFormat: 'unorm8' as const }),
		pixels: new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, plan.byteLength) });
}

function capturePlacement(value: unknown, width: number, height: number): Readonly<GraphicWatermarkPlacementV1> {
	const input = record(value, 'graphic watermark placement', ['anchor', 'widthFraction', 'marginPixels', 'opacity']);
	const anchor = field(input, 'anchor', 'graphic watermark placement');
	if (typeof anchor !== 'string' || !/^(?:top|middle|bottom)-(?:left|center|right)$/u.test(anchor)) throw new RangeError('Unsupported graphic watermark anchor.');
	const unit = (key: string, minimum: number) => {
		const value = field(input, key, 'graphic watermark placement');
		if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 1) throw new RangeError('Graphic watermark placement is outside its numeric domain.');
		return value;
	};
	return Object.freeze({ anchor: anchor as GraphicWatermarkPlacementV1['anchor'], widthFraction: unit('widthFraction', Number.MIN_VALUE), opacity: unit('opacity', 0),
		marginPixels: integer(field(input, 'marginPixels', 'graphic watermark placement'), 0, Math.floor((Math.min(width, height) - 1) / 2), 'Graphic watermark margin') });
}

function position(anchor: string, side: number, graphic: number, margin: number): number {
	return anchor === 'top' || anchor === 'left' ? margin : anchor === 'bottom' || anchor === 'right' ? side - margin - graphic : Math.floor((side - graphic) / 2);
}
function integer(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} is outside its integer domain.`);
	return value;
}
