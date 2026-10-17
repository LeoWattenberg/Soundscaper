/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { normalizeImageOutputColorProfileV1, prepareImageOutputColorProfileV1, writeImageOutputColorPixelV1,
	type ImageOutputColorProfileV1 } from './image-output-color-profile-v1.ts';
import type { PixelFrameHistogramV1 } from './pixel-frame-histogram-v1.ts';
import { fitPixelSizeV1 } from './pixel-frame-resize-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface ImageOutputSoftProofCurrentV1 { readonly profile: ImageOutputColorProfileV1; readonly bitDepth: 8 | 16; }
export interface ImageOutputSoftProofFrameCurrentV1 {
	readonly frame: Extract<PixelFrameV1, { descriptor: { sampleFormat: 'unorm8' } }> & Readonly<{ pixels: Uint8Array<ArrayBuffer> }>;
	readonly histogram: Readonly<PixelFrameHistogramV1>;
}
const FULL = Object.freeze({ maximumSidePixels: 16384, maximumPixels: 67_108_864, maximumBytes: 268_435_456 });
const NATIVE = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 });
const DISPLAY = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const PROFILES = Object.freeze([{ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
	{ sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, { sampleFormat: 'float32', primaries: 'bt709', transfer: 'linear' }]);
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const MAXIMUM = 512 * 1024 * 1024, RESERVE = 16_384;

/** Temporary presentation policy; never a Develop group or persistent preset. */
export function prepareImageOutputSoftProofCurrentV1(value: unknown): Readonly<ImageOutputSoftProofCurrentV1> {
	const input = record(value, 'image output soft proof', ['profile', 'bitDepth']);
	const profile = normalizeImageOutputColorProfileV1(field(input, 'profile', 'image output soft proof'));
	const bitDepth = field(input, 'bitDepth', 'image output soft proof');
	if (bitDepth !== 8 && bitDepth !== 16) throw new RangeError('Soft proof requires eight- or sixteen-bit output.');
	return Object.freeze({ profile, bitDepth });
}

/** Simulate final target gamut and selected-code precision before the sole
 * canvas8 projection. The target-profile canvas is color managed by its painter.
 * Histograms cover the entire evaluated grid, with exact selected-code clipping
 * counts (a16-bit65534 projected to canvas255 is not a clipped target sample).
 * Source is borrowed; one fitted/full byte plane and32-byte scratch are owned.
 * No encoded plane or target clipping ever feeds back into Develop. */
export async function withImageOutputSoftProofCurrentV1<Result>(value: unknown,
	consume: (view: Readonly<ImageOutputSoftProofFrameCurrentV1>) => Result | Promise<Result>, resolution: 'proxy' | 'full' = 'proxy'): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Soft proof cancellation requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); }; check();
	const input = record(value, 'soft proof frame', ['frame', 'softProof', 'signal'], ['frame', 'softProof']);
	const proof = prepareImageOutputSoftProofCurrentV1(field(input, 'softProof', 'soft proof frame'));
	if (resolution !== 'proxy' && resolution !== 'full') throw new RangeError('Unknown soft-proof display resolution.');
	if (typeof consume !== 'function') throw new TypeError('Soft proof requires a scoped consumer.');
	const raw = field(input, 'frame', 'soft proof frame');
	if (typeof raw !== 'object' || raw === null) throw new TypeError('Soft proof requires a frame.');
	const sourcePlan = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'soft proof source'), { profiles: PROFILES, limits: FULL });
	if (sourcePlan.descriptor.sampleFormat === 'float32') admitPixelFrameV1(sourcePlan.descriptor, { profiles: PROFILES, limits: NATIVE });
	const size = resolution === 'proxy' ? fitPixelSizeV1(sourcePlan.descriptor.width, sourcePlan.descriptor.height, 2048, 2048) : sourcePlan.descriptor;
	const descriptor = Object.freeze({ schemaVersion: 1 as const, width: size.width, height: size.height,
		sampleFormat: 'unorm8' as const, primaries: proof.profile, transfer: 'srgb' as const });
	const output = admitPixelFrameV1(descriptor, { profiles: [{ sampleFormat: 'unorm8', primaries: proof.profile, transfer: 'srgb' }], limits: resolution === 'proxy' ? DISPLAY : FULL });
	if (sourcePlan.byteLength + output.byteLength + RESERVE > MAXIMUM) throw new RangeError('Soft proof exceeds its512MiB working budget.');
	const sourceRecord = record(raw, 'soft proof source', ['descriptor', 'pixels']);
	const source = readPixelFrameV1({ descriptor: sourcePlan.descriptor, pixels: field(sourceRecord, 'pixels', 'soft proof source') }, FULL);
	const buffer = Reflect.apply(BUFFER, source.pixels, []) as ArrayBuffer, length = Number(Reflect.apply(SIZE, buffer, []));
	if (length + output.byteLength + RESERVE > MAXIMUM) throw new RangeError('Soft proof physical backing exceeds its512MiB working budget.');
	const offset = Number(Reflect.apply(OFFSET, source.pixels, []));
	const samples = sourcePlan.descriptor.sampleFormat === 'float32' ? new Float32Array(buffer, offset, sourcePlan.sampleCount) : new Uint8Array(buffer, offset, sourcePlan.sampleCount);
	const current = () => { check(); if (Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Soft proof borrowed source detached.'); };
	const color = prepareImageOutputColorProfileV1({ ...proof, source: sourcePlan.descriptor.sampleFormat === 'float32' ? 'linear-srgb' : 'encoded-srgb8' });
	const maximum = proof.bitDepth === 8 ? 255 : 65535;
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = owner.bytes(output.byteLength), codes = new Float64Array(owner.bytes(32).buffer), budget = new RepairTaskBudgetV1(current);
		const channels = [new Array<number>(256).fill(0), new Array<number>(256).fill(0), new Array<number>(256).fill(0)];
		const low: [number, number, number] = [0, 0, 0], high: [number, number, number] = [0, 0, 0];
		let sampledPixels = 0, transparentPixels = 0, lowClippedPixels = 0, highClippedPixels = 0;
		const convert = (from: number) => { writeImageOutputColorPixelV1(color, samples[from]!, samples[from + 1]!, samples[from + 2]!, samples[from + 3]!, codes); };
		const paint = (to: number) => { for (let channel = 0; channel < 4; channel++) pixels[to + channel] = Math.round(codes[channel]! * 255 / maximum); };
		for (let at = 0; at < sourcePlan.sampleCount; at += 4) {
			convert(at); if (output.pixelCount === sourcePlan.pixelCount) paint(at);
			if (codes[3] === 0) transparentPixels++;
			else {
				sampledPixels++; let lo = false, hi = false;
				for (let channel = 0; channel < 3; channel++) {
					const code = codes[channel]!, bins = channels[channel]!, bin = Math.round(code * 255 / maximum); bins[bin] = bins[bin]! + 1;
					if (code === 0) { low[channel]++; lo = true; } if (code === maximum) { high[channel]++; hi = true; }
				}
				if (lo) lowClippedPixels++; if (hi) highClippedPixels++;
			}
			if (budget.visit()) await budget.yield();
		}
		if (output.pixelCount !== sourcePlan.pixelCount) for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
			convert((Math.floor(y * sourcePlan.descriptor.height / size.height) * sourcePlan.descriptor.width + Math.floor(x * sourcePlan.descriptor.width / size.width)) * 4);
			paint((y * size.width + x) * 4); if (budget.visit()) await budget.yield();
		}
		current();
		const histogram: Readonly<PixelFrameHistogramV1> = Object.freeze({ schemaVersion: 1, sampledPixels, transparentPixels,
			bins: Object.freeze({ red: Object.freeze(channels[0]!), green: Object.freeze(channels[1]!), blue: Object.freeze(channels[2]!) }),
			lowClippedChannels: Object.freeze(low), highClippedChannels: Object.freeze(high), lowClippedPixels, highClippedPixels });
		const result = await consume(Object.freeze({ frame: Object.freeze({ descriptor, pixels }), histogram })); current(); return result;
	});
}
