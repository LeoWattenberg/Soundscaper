/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { readPixelFrameDescriptorV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import type { RawRecoveryFrameV2, RawRecoveryProfileV2 } from '../libraw-wasm-instance-v2.ts';

type Binding = Readonly<{ pixels: Float32Array; buffer: ArrayBuffer; length: number; width: number; height: number; profile: RawRecoveryProfileV2 }>;
const active = new WeakMap<object, Binding>();
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;

/** Native runtime composition only. The record expires before scoped pixels
 * are wiped. Wrapper normalization may retain this exact plane; copying or
 * relabelling pixels cannot transfer fixed-profile processing authority. */
export async function withRawRecoveryFrameAuthorityV1<Result>(view: Readonly<RawRecoveryFrameV2>,
	consume: (view: Readonly<RawRecoveryFrameV2>) => Result | Promise<Result>): Promise<Result> {
	const plane = capture(view.frame), binding = Object.freeze({ ...plane, profile: view.profile });
	if (active.has(plane.pixels)) throw new TypeError('RAW recovery plane already has an active borrower.');
	active.set(plane.pixels, binding);
	try { return await consume(view); }
	finally { if (active.get(plane.pixels) === binding) active.delete(plane.pixels); }
}

/** Metadata alone grants no permission to skip native source processing. */
export function assertRawRecoveryFrameAuthorityV1(value: unknown, profile: RawRecoveryProfileV2): void {
	const plane = capture(value), binding = active.get(plane.pixels);
	if (!binding || binding.profile !== profile || binding.buffer !== plane.buffer || binding.length !== plane.length
		|| binding.width !== plane.width || binding.height !== plane.height) {
		throw new TypeError('RAW source processing requires its active matching native frame.');
	}
}

function capture(value: unknown) {
	const input = record(value, 'RAW processing source', ['descriptor', 'pixels']);
	const descriptor = readPixelFrameDescriptorV1(field(input, 'descriptor', 'RAW processing source'));
	if (descriptor.sampleFormat !== 'float32' || descriptor.primaries !== 'srgb' || descriptor.transfer !== 'linear'
		|| descriptor.width < 16 || descriptor.height < 16 || descriptor.width > 8192 || descriptor.height > 8192
		|| descriptor.width * descriptor.height > 16_777_216) throw new RangeError('RAW processing requires its bounded native linear Float32 extent.');
	const pixels = field(input, 'pixels', 'RAW processing source');
	if (!(pixels instanceof Float32Array) || Object.getPrototypeOf(pixels) !== Float32Array.prototype) throw new TypeError('RAW processing requires its native Float32 plane.');
	for (const name of ['buffer', 'length', 'byteLength', 'byteOffset']) if (Object.hasOwn(pixels, name)) throw new TypeError('RAW processing source may not shadow its geometry.');
	const buffer = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer, length = descriptor.width * descriptor.height * 16;
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || Reflect.apply(SIZE, buffer, []) !== length
		|| Reflect.apply(OFFSET, pixels, []) !== 0 || Reflect.apply(LENGTH, pixels, []) !== length) {
		throw new TypeError('RAW processing source changed its private physical storage.');
	}
	return { pixels, buffer, length, width: descriptor.width, height: descriptor.height };
}
