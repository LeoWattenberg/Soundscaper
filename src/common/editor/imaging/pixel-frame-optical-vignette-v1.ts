/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareOpticalVignetteEffectV1 } from '../video-optical-vignette-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { prepareImageOpticalVignetteKernelV1, imageOpticalVignetteGainV1 } from './image-optical-vignette-kernel-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface OpticalVignettePixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
const MAXIMUM_WORKING_BYTES = 512 * 1024 * 1024;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set;

/** One continuous sRGB decode/light gain/encode followed by final clipping
 * and byte rounding. The input byte plane is never used as linear light. */
function encodeGainedByte(value: number, gain: number): number {
	if (value === 0) return value;
	const encoded = value / 255;
	const linear = (encoded <= .04045 ? encoded / 12.92 : ((encoded + .055) / 1.055) ** 2.4) * gain;
	const output = linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055;
	return Math.round(255 * Math.max(0, Math.min(1, output)));
}

/** Borrow immutable encoded-sRGB input; own one joined callback-scoped
 * output, with no image-sized scratch. Transparent hidden RGB, alpha and
 * gain1 pixels remain exact instead of taking a transfer roundtrip. */
export async function withOpticalVignettePixelFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<OpticalVignettePixelFrameV1>) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Optical vignette cancellation must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), checkSignal = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		checkSignal(); if (typeof consume !== 'function') throw new TypeError('Optical vignette requires a scoped consumer.');
		const input = record(value, 'Optical vignette frame request', ['frame', 'effect', 'signal'], ['frame', 'effect']);
		const options = record(optionsValue, 'Optical vignette frame options', ['limits']), limits = field(options, 'limits', 'Optical vignette frame options');
		const effect = prepareOpticalVignetteEffectV1(field(input, 'effect', 'Optical vignette frame request'));
		const raw = field(input, 'frame', 'Optical vignette frame request');
		if (typeof raw !== 'object' || raw === null) throw new TypeError('Optical vignette requires a source frame.');
		const metadata = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Optical vignette source frame'), { limits });
		const kernel = prepareImageOpticalVignetteKernelV1(effect.amount, metadata.descriptor.width, metadata.descriptor.height);
		if (metadata.byteLength * 2 > MAXIMUM_WORKING_BYTES) throw new RangeError('Optical vignette exceeds its declared working byte budget.');
		const captured = record(raw, 'Optical vignette source frame', ['descriptor', 'pixels']);
		const frame = readPixelFrameV1({ descriptor: metadata.descriptor, pixels: field(captured, 'pixels', 'Optical vignette source frame') }, limits);
		if (frame.descriptor.sampleFormat !== 'unorm8') throw new TypeError('Byte optical vignette requires encoded sRGB UNORM8.');
		const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, backingBytes = Number(Reflect.apply(SIZE, backing, []));
		if (backingBytes + metadata.byteLength > MAXIMUM_WORKING_BYTES) throw new RangeError('Optical vignette exceeds its physical working byte budget.');
		const pixels = new Uint8Array(backing, Number(Reflect.apply(OFFSET, frame.pixels, [])), metadata.byteLength);
		checkSignal(); return { metadata, effect, kernel, pixels, backing, backingBytes };
	} catch (error) { checkSignal(); throw error; } })();
	const check = () => {
		checkSignal();
		if (Reflect.apply(SIZE, prepared.backing, []) !== prepared.backingBytes) throw new TypeError('Optical vignette source was detached or changed.');
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = owner.bytes(prepared.metadata.byteLength), budget = new RepairTaskBudgetV1(check); check();
		if (!prepared.effect.enabled || prepared.effect.neutral) Reflect.apply(SET, pixels, [prepared.pixels]);
		else {
			const { width, height } = prepared.metadata.descriptor, source = prepared.pixels;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const index = (y * width + x) * 4, gain = source[index + 3] === 0 ? 1 : imageOpticalVignetteGainV1(prepared.kernel, x, y);
				for (let channel = 0; channel < 3; channel++) {
					const sample = source[index + channel]!; pixels[index + channel] = gain === 1 ? sample : encodeGainedByte(sample, gain);
				}
				pixels[index + 3] = source[index + 3]!;
				if (budget.visit()) await budget.yield();
			}
		}
		check(); const descriptor = Object.freeze({ ...prepared.metadata.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); check(); return result;
	});
}
