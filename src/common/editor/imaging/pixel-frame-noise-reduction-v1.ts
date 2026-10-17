/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { noiseReductionLumaV1, noiseReductionChromaV1, prepareNoiseReductionEffectV1 } from '../video-noise-reduction-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface NoiseReductionPixelFrameV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly pixels: Uint8Array<ArrayBuffer> }
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const BINOMIAL5 = Object.freeze([1,4,6,4,1] as const);

/** One immutable input snapshot and one scoped output; no pixel-sized planes,
 * objects or masks. Both strengths read the original neighborhood. */
export async function withNoiseReductionPixelFrameV1<Result>(value: unknown,
	consume: (frame: NoiseReductionPixelFrameV1) => Result | Promise<Result>, options: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value, 'noise reduction frame', ['frame', 'effect', 'signal'], ['frame', 'effect']);
	const option = record(options, 'noise reduction options', ['limits']), limits = field(option, 'limits', 'noise reduction options');
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'noise reduction frame') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Noise reduction requires a scoped consumer.');
	const effect = prepareNoiseReductionEffectV1(field(input, 'effect', 'noise reduction frame'));
	const raw = record(field(input, 'frame', 'noise reduction frame'), 'noise reduction source', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'noise reduction source'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'noise reduction source') }, limits);
	const original = new Uint8Array(new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength));
	const sourceBuffer = original.buffer; let outputBuffer: ArrayBuffer | undefined;
	try {
		const pixels = new Uint8Array(original); outputBuffer = pixels.buffer;
		if (effect.enabled && !effect.neutral) {
			const { width, height } = plan.descriptor; let processed = 0;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				check(); const offset = 4 * (y * width + x);
				if (original[offset + 3] !== 0) {
					const co = original[offset]! - original[offset + 2]!, t = original[offset + 2]! + Math.floor(co / 2);
					const cg = original[offset + 1]! - t, luma = t + Math.floor(cg / 2);
					let reducedLuma = luma, reducedCo = co, reducedCg = cg;
					if (effect.luminanceQ8 !== 0) {
						let sum = 0, weight = 0, minimum = luma, maximum = luma;
						for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
							const n = 4 * (Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx)));
							const alpha = original[n + 3]!; if (alpha === 0) continue;
							const nt = original[n + 2]! + Math.floor((original[n]! - original[n + 2]!) / 2);
							const ny = nt + Math.floor((original[n + 1]! - nt) / 2);
							minimum = Math.min(minimum, ny); maximum = Math.max(maximum, ny);
							const w = alpha * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) * Math.max(0, 16 - Math.floor(Math.abs(ny - luma) * effect.luminanceDetailQ8 / 256));
							weight += w; sum += w * ny;
						}
						reducedLuma = noiseReductionLumaV1(effect, luma, sum, weight, minimum, maximum);
					}
					if (effect.colorQ8 !== 0) {
						let sumCo = 0, sumCg = 0, weight = 0;
						for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
							const inner = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) : 0;
							const spatial = Math.floor((inner * 16 * (256 - effect.colorSmoothnessQ8) + BINOMIAL5[dx + 2]! * BINOMIAL5[dy + 2]! * effect.colorSmoothnessQ8 + 128) / 256);
							if (spatial === 0) continue;
							const n = 4 * (Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx)));
							const alpha = original[n + 3]!; if (alpha === 0) continue;
							const nco = original[n]! - original[n + 2]!, ncg = original[n + 1]! - (original[n + 2]! + Math.floor(nco / 2));
							const distance = Math.max(Math.abs(nco - co), Math.abs(ncg - cg));
							const w = spatial * alpha * Math.max(0, 16 - Math.floor(distance * effect.colorDetailQ8 / 256));
							weight += w; sumCo += w * nco; sumCg += w * ncg;
						}
						reducedCo = noiseReductionChromaV1(effect, co, sumCo, weight); reducedCg = noiseReductionChromaV1(effect, cg, sumCg, weight);
					}
					const reducedT = reducedLuma - Math.floor(reducedCg / 2), blue = reducedT - Math.floor(reducedCo / 2);
					pixels[offset] = Math.max(0, Math.min(255, reducedCo + blue));
					pixels[offset + 1] = Math.max(0, Math.min(255, reducedCg + reducedT)); pixels[offset + 2] = Math.max(0, Math.min(255, blue));
				}
				processed += 4;
				if (processed >= 256 * 1024) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); processed = 0; check(); }
			}
		}
		check(); const result = await consume(Object.freeze({ descriptor: plan.descriptor, pixels })); check(); return result;
	} finally { wipe(sourceBuffer); if (outputBuffer) wipe(outputBuffer); }
}

function wipe(buffer: ArrayBuffer): void { if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0); }
