/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { planImageLensDistortionV1, writeImageLensDistortionPointV1 } from './image-lens-distortion-plan-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface LensDistortionPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
const MAXIMUM_WORKING_BYTES = 512 * 1024 * 1024;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set;

/** One scoped byte output, no frame scratch. Filtering stays in encoded sRGB
 * with premultiplied alpha. Full source backing plus output must fit512MiB.
 * Source remains borrowed and must not mutate until this operation settles. */
export async function withLensDistortionPixelFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<LensDistortionPixelFrameV1>) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Lens cancellation must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), checkSignal = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		checkSignal(); if (typeof consume !== 'function') throw new TypeError('Lens distortion requires a scoped consumer.');
		const input = record(value, 'lens frame request', ['frame', 'amount', 'signal'], ['frame', 'amount']);
		const options = record(optionsValue, 'lens frame options', ['limits']), limits = field(options, 'limits', 'lens frame options');
		const raw = field(input, 'frame', 'lens frame request');
		if (typeof raw !== 'object' || raw === null) throw new TypeError('Lens distortion requires a source frame.');
		const metadata = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'lens source frame'), { limits });
		const mapping = planImageLensDistortionV1(field(input, 'amount', 'lens frame request'), metadata.descriptor.width, metadata.descriptor.height);
		const captured = record(raw, 'lens source frame', ['descriptor', 'pixels']);
		const frame = readPixelFrameV1({ descriptor: metadata.descriptor, pixels: field(captured, 'pixels', 'lens source frame') }, limits);
		if (frame.descriptor.sampleFormat !== 'unorm8') throw new TypeError('Byte lens distortion requires encoded sRGB UNORM8.');
		const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, backingBytes = Number(Reflect.apply(SIZE, backing, []));
		if (backingBytes + metadata.byteLength > MAXIMUM_WORKING_BYTES) throw new RangeError('Lens distortion exceeds its physical working byte budget.');
		const pixels = new Uint8Array(backing, Number(Reflect.apply(OFFSET, frame.pixels, [])), metadata.byteLength);
		checkSignal(); return { metadata, mapping, pixels, backing, backingBytes };
	} catch (error) { checkSignal(); throw error; } })();
	const check = () => {
		checkSignal();
		if (Reflect.apply(SIZE, prepared.backing, []) !== prepared.backingBytes) throw new TypeError('Lens source was detached or changed.');
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = owner.bytes(prepared.metadata.byteLength), budget = new RepairTaskBudgetV1(check), point = { x: 0, y: 0 };
		check();
		if (prepared.mapping.neutral) Reflect.apply(SET, pixels, [prepared.pixels]);
		else {
			const { width, height } = prepared.mapping;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				if (writeImageLensDistortionPointV1(prepared.mapping, x + .5, y + .5, point)) sample(prepared.pixels, pixels, offset, width, height, point.x - .5, point.y - .5);
				if (budget.visit()) await budget.yield();
			}
		}
		check(); const descriptor = Object.freeze({ ...prepared.metadata.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); check(); return result;
	});
}

function sample(source: Uint8Array<ArrayBuffer>, target: Uint8Array<ArrayBuffer>, offset: number,
	width: number, height: number, x: number, y: number): void {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	let red = 0, green = 0, blue = 0, alpha = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = ix + dx, sy = iy + dy;
		if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
		const from = (sy * width + sx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), a = source[from + 3]! * weight;
		alpha += a; red += source[from]! * a; green += source[from + 1]! * a; blue += source[from + 2]! * a;
	}
	target[offset + 3] = Math.round(alpha);
	if (target[offset + 3] === 0) { target[offset] = 0; target[offset + 1] = 0; target[offset + 2] = 0; return; }
	target[offset] = Math.round(red / alpha); target[offset + 1] = Math.round(green / alpha); target[offset + 2] = Math.round(blue / alpha);
}
