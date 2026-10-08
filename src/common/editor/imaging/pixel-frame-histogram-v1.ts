/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';

export interface PixelFrameHistogramV1 {
	readonly schemaVersion: 1;
	readonly sampledPixels: number;
	readonly transparentPixels: number;
	readonly bins: Readonly<{ red: readonly number[]; green: readonly number[]; blue: readonly number[] }>;
	/** Channel order is red, green, blue. Only visible samples contribute. */
	readonly lowClippedChannels: readonly [number, number, number];
	readonly highClippedChannels: readonly [number, number, number];
	readonly lowClippedPixels: number;
	readonly highClippedPixels: number;
}

const CHUNK_BYTES = 256 * 1024;
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;

/**
 * Histogram of rendered encoded sRGB, rather than an implicit conversion of
 * original camera data. Zero alpha is excluded; every nonzero-alpha pixel
 * contributes one unweighted straight RGB sample. Clipping means any channel
 * is exactly 0 or 255. Source pixels stay borrowed and must remain unchanged
 * while this operation runs. Only three fixed 256-bin arrays are accumulated.
 */
export async function createPixelFrameHistogramV1(value: unknown, optionsValue: unknown = {}): Promise<PixelFrameHistogramV1> {
	const options = record(optionsValue, 'pixel histogram options', ['limits', 'signal'], []);
	const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'pixel histogram options') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Histogram requires a native cancellation signal.');
	const check = () => { if (signal) Reflect.apply(ABORT_CHECK, signal, []); };
	check();
	const input = record(value, 'histogram source frame', ['descriptor', 'pixels']);
	const limits = Object.hasOwn(options, 'limits') ? field(options, 'limits', 'pixel histogram options') : {};
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'histogram source frame'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'histogram source frame') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Histogram requires UNORM8 rendered samples.');
	const pixels = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, plan.byteLength), buffer = pixels.buffer;
	if (!BUFFER_SIZE) throw new TypeError('Histogram requires intrinsic ArrayBuffer geometry.');
	const checkSource = () => {
		check();
		if (Reflect.apply(BUFFER_SIZE, buffer, []) === 0) throw new RangeError('Histogram source buffer was detached before completion.');
	};
	const channels = [new Array<number>(256).fill(0), new Array<number>(256).fill(0), new Array<number>(256).fill(0)];
	const low: [number, number, number] = [0, 0, 0], high: [number, number, number] = [0, 0, 0];
	let sampledPixels = 0, transparentPixels = 0, lowClippedPixels = 0, highClippedPixels = 0;
	for (let start = 0; start < plan.byteLength; start += CHUNK_BYTES) {
		checkSource();
		const end = Math.min(start + CHUNK_BYTES, plan.byteLength);
		for (let index = start; index < end; index += 4) {
			if (pixels[index + 3] === 0) { transparentPixels++; continue; }
			sampledPixels++;
			let lowClipped = false, highClipped = false;
			for (let channel = 0; channel < 3; channel++) {
				const sample = pixels[index + channel];
				channels[channel][sample]++;
				if (sample === 0) { low[channel]++; lowClipped = true; }
				if (sample === 255) { high[channel]++; highClipped = true; }
			}
			if (lowClipped) lowClippedPixels++;
			if (highClipped) highClippedPixels++;
		}
		if (end < plan.byteLength) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); checkSource(); }
	}
	checkSource();
	return Object.freeze({ schemaVersion: 1, sampledPixels, transparentPixels,
		bins: Object.freeze({ red: Object.freeze(channels[0]), green: Object.freeze(channels[1]), blue: Object.freeze(channels[2]) }),
		lowClippedChannels: Object.freeze(low), highClippedChannels: Object.freeze(high), lowClippedPixels, highClippedPixels });
}
