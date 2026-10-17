/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { detailSharpenByteV1, prepareDetailSharpenEffectV1 } from '../video-sharpen-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface DetailSharpenPixelFrameV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly pixels: Uint8Array<ArrayBuffer> }
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One immutable native source snapshot and one scoped output. Neighborhoods
 * always read the same stage input; neither backing escapes after settlement. */
export async function withDetailSharpenPixelFrameV1<Result>(value: unknown,
	consume: (frame: DetailSharpenPixelFrameV1) => Result | Promise<Result>, options: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value, 'detail sharpening frame', ['frame', 'effect', 'signal'], ['frame', 'effect']);
	const option = record(options, 'detail sharpening options', ['limits']), limits = field(option, 'limits', 'detail sharpening options');
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'detail sharpening frame') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Detail sharpening requires a scoped consumer.');
	const effect = prepareDetailSharpenEffectV1(field(input, 'effect', 'detail sharpening frame'));
	const raw = record(field(input, 'frame', 'detail sharpening frame'), 'detail sharpening source', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'detail sharpening source'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'detail sharpening source') }, limits);
	const original = new Uint8Array(new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength));
	const sourceBuffer = original.buffer; let outputBuffer: ArrayBuffer | undefined;
	try {
		const pixels = new Uint8Array(original); outputBuffer = pixels.buffer;
		if (effect.enabled && !effect.neutral) {
			const { width, height } = plan.descriptor;
			let processed = 0;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				check(); const offset = 4 * (y * width + x);
				if (original[offset + 3] !== 0) {
					let weight = 0, red = 0, green = 0, blue = 0;
					for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
						const n = 4 * (Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx)));
						const alphaWeight = original[n + 3]! * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
						weight += alphaWeight; red += alphaWeight * original[n]!; green += alphaWeight * original[n + 1]!; blue += alphaWeight * original[n + 2]!;
					}
					pixels[offset] = detailSharpenByteV1(effect, original[offset]!, red, weight);
					pixels[offset + 1] = detailSharpenByteV1(effect, original[offset + 1]!, green, weight);
					pixels[offset + 2] = detailSharpenByteV1(effect, original[offset + 2]!, blue, weight);
				}
				processed += 4;
				if (processed >= 256 * 1024) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); processed = 0; check(); }
			}
		}
		check(); const result = await consume(Object.freeze({ descriptor: plan.descriptor, pixels })); check(); return result;
	}
	finally { wipe(sourceBuffer); if(outputBuffer) wipe(outputBuffer); }
}

function wipe(buffer: ArrayBuffer): void { if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0); }
