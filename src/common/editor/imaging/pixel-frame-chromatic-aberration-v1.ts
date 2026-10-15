/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { planImageChromaticAberrationV1, writeImageChromaticAberrationTapsV1, type ImageChromaticAberrationTapsV1 } from './image-chromatic-aberration-plan-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface ChromaticAberrationPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
const MAXIMUM_WORKING_BYTES = 512 * 1024 * 1024;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set;

/** Borrow immutable encoded-sRGB input and own one callback-scoped output.
 * R/B use separate premultiplied reconstruction; Green/reference alpha and
 * every zero-controlled component copy exactly, including hidden color. */
export async function withChromaticAberrationPixelFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<ChromaticAberrationPixelFrameV1>) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Chromatic aberration cancellation must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), checkSignal = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		checkSignal(); if (typeof consume !== 'function') throw new TypeError('Chromatic aberration requires a scoped consumer.');
		const input = record(value, 'CA frame request', ['frame', 'red', 'blue', 'signal'], ['frame', 'red', 'blue']);
		const options = record(optionsValue, 'CA frame options', ['limits']), limits = field(options, 'limits', 'CA frame options');
		const raw = field(input, 'frame', 'CA frame request');
		if (typeof raw !== 'object' || raw === null) throw new TypeError('Chromatic aberration requires a source frame.');
		const metadata = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'CA source frame'), { limits });
		const mapping = planImageChromaticAberrationV1(field(input, 'red', 'CA frame request'), field(input, 'blue', 'CA frame request'), metadata.descriptor.width, metadata.descriptor.height);
		const captured = record(raw, 'CA source frame', ['descriptor', 'pixels']);
		const frame = readPixelFrameV1({ descriptor: metadata.descriptor, pixels: field(captured, 'pixels', 'CA source frame') }, limits);
		if (frame.descriptor.sampleFormat !== 'unorm8') throw new TypeError('Byte chromatic aberration requires encoded sRGB UNORM8.');
		const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, backingBytes = Number(Reflect.apply(SIZE, backing, []));
		if (backingBytes + metadata.byteLength > MAXIMUM_WORKING_BYTES) throw new RangeError('Chromatic aberration exceeds its physical working byte budget.');
		const pixels = new Uint8Array(backing, Number(Reflect.apply(OFFSET, frame.pixels, [])), metadata.byteLength);
		checkSignal(); return { metadata, mapping, pixels, backing, backingBytes };
	} catch (error) { checkSignal(); throw error; } })();
	const check = () => {
		checkSignal();
		if (Reflect.apply(SIZE, prepared.backing, []) !== prepared.backingBytes) throw new TypeError('Chromatic aberration source was detached or changed.');
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = owner.bytes(prepared.metadata.byteLength), budget = new RepairTaskBudgetV1(check);
		const taps: ImageChromaticAberrationTapsV1 = { x: 0, y: 0, stepX: 1, stepY: 1, fractionX: 0, fractionY: 0 };
		check();
		if (prepared.mapping.neutral) Reflect.apply(SET, pixels, [prepared.pixels]);
		else {
			const mapping = prepared.mapping, { width, height } = mapping, source = prepared.pixels;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				pixels[offset] = mapping.red === 0 ? source[offset]! : writeImageChromaticAberrationTapsV1(mapping, 'red', x, y, taps)
					? sample(source, 0, width, height, taps) : 0;
				pixels[offset + 1] = source[offset + 1]!;
				pixels[offset + 2] = mapping.blue === 0 ? source[offset + 2]! : writeImageChromaticAberrationTapsV1(mapping, 'blue', x, y, taps)
					? sample(source, 2, width, height, taps) : 0;
				pixels[offset + 3] = source[offset + 3]!;
				if (budget.visit()) await budget.yield();
			}
		}
		check(); const descriptor = Object.freeze({ ...prepared.metadata.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); check(); return result;
	});
}

function sample(source: Uint8Array<ArrayBuffer>, channel: 0 | 2, width: number, height: number, taps: ImageChromaticAberrationTapsV1): number {
	let value = 0, alpha = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = taps.x + dx * taps.stepX, sy = taps.y + dy * taps.stepY;
		if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
		const from = (sy * width + sx) * 4, weight = (dx ? taps.fractionX : 1 - taps.fractionX) * (dy ? taps.fractionY : 1 - taps.fractionY), a = source[from + 3]! * weight;
		alpha += a; value += source[from + channel]! * a;
	}
	return alpha === 0 ? 0 : Math.round(value / alpha);
}
