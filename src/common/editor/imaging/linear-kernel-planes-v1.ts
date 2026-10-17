/* SPDX-License-Identifier: AGPL-3.0-only */
import { captureLinearKernelDescriptorV1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
export { captureLinearKernelDescriptorV1, LINEAR_KERNEL_LIMITS_V1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
const NativeFloat = Float32Array, NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

function capture(value: unknown, tag: 'Float32Array' | 'Uint8Array', expectedBytes: number) {
	if (Reflect.apply(TAG, value, []) !== tag) throw new TypeError('Linear kernel requires its native typed plane.');
	for (const name of ['buffer', 'length', 'byteLength', 'byteOffset']) if (Object.hasOwn(value as object, name)) throw new TypeError('Linear kernel plane cannot shadow native geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	const length = Number(Reflect.apply(LENGTH, value, [])), offset = Number(Reflect.apply(OFFSET, value, []));
	const size = Number(Reflect.apply(SIZE, buffer, []));
	if ((RESIZABLE && Reflect.apply(RESIZABLE, buffer, []) !== false) || offset !== 0 || size !== expectedBytes || length !== expectedBytes) {
		throw new TypeError('Linear kernel plane requires an exact dedicated fixed backing.');
	}
	const check = () => {
		if (Reflect.apply(SIZE, buffer, []) !== size || Reflect.apply(BUFFER, value, []) !== buffer
			|| Reflect.apply(LENGTH, value, []) !== length || Reflect.apply(OFFSET, value, []) !== offset) throw new TypeError('Linear kernel plane detached or changed.');
		// Construction also distinguishes a detached zero-byte scratch buffer.
		void new NativeBytes(buffer, 0, 0);
	};
	check(); return { buffer, check };
}

/** Borrow dedicated planes only. No output copy, conversion, hidden frame
 * allocation or cleanup occurs here; the outer lifecycle owns those bytes. */
export function captureLinearKernelPlanesV1(sourceDescriptor: LinearKernelDescriptorV1, sourceValue: unknown, targetValue: unknown,
	targetDescriptor: LinearKernelDescriptorV1 = sourceDescriptor) {
	const sourceMeta = captureLinearKernelDescriptorV1(sourceDescriptor), targetMeta = captureLinearKernelDescriptorV1(targetDescriptor);
	const sourcePlan = capture(sourceValue, 'Float32Array', sourceMeta.width * sourceMeta.height * 16);
	const targetPlan = capture(targetValue, 'Float32Array', targetMeta.width * targetMeta.height * 16);
	if (sourcePlan.buffer === targetPlan.buffer) throw new TypeError('Linear kernel input and output require separate immutable planes.');
	const source = new NativeFloat(sourcePlan.buffer), target = new NativeFloat(targetPlan.buffer);
	for (let index = 0; index < source.length; index++) {
		const sample = source[index]!;
		if (!Number.isFinite(sample) || (index % 4 === 3 && (sample < 0 || sample > 1))) throw new RangeError('Linear kernel source requires finite RGB and unit straight alpha.');
	}
	const check = () => { sourcePlan.check(); targetPlan.check(); };
	check(); return Object.freeze({ source, target, check });
}

export function captureLinearKernelScratchV1(value: unknown, expectedBytes: number, forbiddenBuffers: readonly ArrayBuffer[]) {
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > 768 * 1024 * 1024) throw new RangeError('Invalid linear kernel scratch budget.');
	const plan = capture(value, 'Uint8Array', expectedBytes);
	if (forbiddenBuffers.includes(plan.buffer)) throw new TypeError('Linear kernel scratch must be independently owned.');
	return Object.freeze({ bytes: new NativeBytes(plan.buffer), check: plan.check });
}

/** Certify all channels before touching one destination pixel. Float32 stage
 * rounding belongs here; output alpha is supplied by its owning operation. */
export function writeLinearKernelPixelV1(target: Float32Array<ArrayBuffer>, offset: number, red: number, green: number, blue: number, alpha: number): void {
	const r = Math.fround(red), g = Math.fround(green), b = Math.fround(blue), a = Math.fround(alpha);
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a) || alpha < 0 || alpha > 1) throw new RangeError('Linear kernel output exceeds finite Float32 RGB or unit alpha.');
	target[offset] = r; target[offset + 1] = g; target[offset + 2] = b; target[offset + 3] = a;
}

/** Odd extended sRGB transfer, with no clipping or quantization. */
export function linearKernelEncodedV1(value: number): number { const n = Math.abs(value); return Math.sign(value) * (n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055); }
export function linearKernelDecodedV1(value: number): number { const n = Math.abs(value); return Math.sign(value) * (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4); }
