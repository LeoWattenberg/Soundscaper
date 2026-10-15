/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareDefringeEffectV1 } from '../video-defringe-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { assertImageDefringeGeometryV1, writeImageDefringeKernelPixelV1, type ImageDefringeKernelPixelV1 } from './image-defringe-kernel-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface DefringePixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
const MAXIMUM_WORKING_BYTES = 512 * 1024 * 1024;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set;
const encoded = (value: number) => value / 255;

/** Borrow immutable encoded-sRGB input; own one joined, callback-scoped
 * result. Neighborhood taps always read the incoming source, with zero-alpha
 * and uncorrected channels copied exactly, including hidden color. */
export async function withDefringePixelFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<DefringePixelFrameV1>) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Defringe cancellation must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), checkSignal = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		checkSignal(); if (typeof consume !== 'function') throw new TypeError('Defringe requires a scoped consumer.');
		const input = record(value, 'Defringe frame request', ['frame', 'effect', 'signal'], ['frame', 'effect']);
		const options = record(optionsValue, 'Defringe frame options', ['limits']), limits = field(options, 'limits', 'Defringe frame options');
		const effect = prepareDefringeEffectV1(field(input, 'effect', 'Defringe frame request'));
		const raw = field(input, 'frame', 'Defringe frame request');
		if (typeof raw !== 'object' || raw === null) throw new TypeError('Defringe requires a source frame.');
		const metadata = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Defringe source frame'), { limits });
		assertImageDefringeGeometryV1(metadata.descriptor.width, metadata.descriptor.height);
		if (metadata.byteLength * 2 > MAXIMUM_WORKING_BYTES) throw new RangeError('Defringe exceeds its declared working byte budget.');
		const captured = record(raw, 'Defringe source frame', ['descriptor', 'pixels']);
		const frame = readPixelFrameV1({ descriptor: metadata.descriptor, pixels: field(captured, 'pixels', 'Defringe source frame') }, limits);
		if (frame.descriptor.sampleFormat !== 'unorm8') throw new TypeError('Byte Defringe requires encoded sRGB UNORM8.');
		const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, backingBytes = Number(Reflect.apply(SIZE, backing, []));
		if (backingBytes + metadata.byteLength > MAXIMUM_WORKING_BYTES) throw new RangeError('Defringe exceeds its physical working byte budget.');
		const pixels = new Uint8Array(backing, Number(Reflect.apply(OFFSET, frame.pixels, [])), metadata.byteLength);
		checkSignal(); return { metadata, effect, pixels, backing, backingBytes };
	} catch (error) { checkSignal(); throw error; } })();
	const check = () => {
		checkSignal();
		if (Reflect.apply(SIZE, prepared.backing, []) !== prepared.backingBytes) throw new TypeError('Defringe source was detached or changed.');
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = owner.bytes(prepared.metadata.byteLength), budget = new RepairTaskBudgetV1(check);
		const output: ImageDefringeKernelPixelV1 = { red: 0, green: 0, blue: 0, redChanged: false, greenChanged: false, blueChanged: false };
		check();
		if (!prepared.effect.enabled || prepared.effect.neutral) Reflect.apply(SET, pixels, [prepared.pixels]);
		else {
			const { width, height } = prepared.metadata.descriptor, source = prepared.pixels;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const index = (y * width + x) * 4;
				if (source[index + 3] === 0) {
					pixels[index] = source[index]!; pixels[index + 1] = source[index + 1]!; pixels[index + 2] = source[index + 2]!;
				} else {
					writeImageDefringeKernelPixelV1(prepared.effect, source, width, height, x, y, encoded, output);
					pixels[index] = output.redChanged ? Math.round(255 * output.red) : source[index]!;
					pixels[index + 1] = output.greenChanged ? Math.round(255 * output.green) : source[index + 1]!;
					pixels[index + 2] = output.blueChanged ? Math.round(255 * output.blue) : source[index + 2]!;
				}
				pixels[index + 3] = source[index + 3]!;
				if (budget.visit()) await budget.yield();
			}
		}
		check(); const descriptor = Object.freeze({ ...prepared.metadata.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); check(); return result;
	});
}
