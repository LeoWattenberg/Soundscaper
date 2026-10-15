/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { readPixelFrameDescriptorV1, readPixelFrameV1, type PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { RepairTaskBudgetV1, captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { withDecodedRawOriginalV1 } from '../../common/editor/raw/libraw-runtime-v1.ts';
import { withDecodedRawRecoveryFrameV2, type RawRecoveryFrameV2, type RawRecoveryPixelFrameV2, type RawRecoveryProfileV2 } from '../../common/editor/raw/libraw-runtime-v2.ts';
import type { PhotoPreviewOriginalBindingV1 } from './photo-preview-plan-v1.ts';
import { withPhotoOriginalEncodedCurrentV1, PHOTO_ORIGINAL_DERIVED_LIMITS_CURRENT_V1 } from './internal/photo-original-encoded-current-v1.ts';
export { admitPhotoOriginalEncodedBindingCurrentV1 as admitPhotoOriginalDerivedBindingCurrentV1 } from './internal/photo-original-encoded-current-v1.ts';

export interface PhotoOriginalDerivedFramePortsCurrentV1 {
	readonly withRawFrame?: typeof withDecodedRawOriginalV1;
	readonly withRecoveryFrame?: typeof withDecodedRawRecoveryFrameV2;
	readonly assertCurrent?: () => void | Promise<void>;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;

/** Canonical ABI 1 validation retires completely before ABI 2 starts. The
 * Original's bytes, canonical receipt semantics and input precision never
 * change; derived Float32 pixels remain scoped and cannot become Original data. */
export async function withPhotoOriginalDerivedFrameCurrentV1<Result>(value: unknown,
	consume: (view: Readonly<RawRecoveryFrameV2>) => Result | Promise<Result>,
	dependencies: Readonly<PhotoOriginalDerivedFramePortsCurrentV1> = {}): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Derived Original signal must be own data.');
	const signal = captureRepairSignalV1(ownSignal?.value);
	const input = record(value, 'derived Current Original', ['binding', 'body', 'profile', 'signal'], ['binding', 'body', 'profile']);
	const profile = readProfile(field(input, 'profile', 'derived Current Original'));
	const binding = field(input, 'binding', 'derived Current Original'), body = field(input, 'body', 'derived Current Original');
	if (typeof consume !== 'function') throw new TypeError('Derived Original requires a scoped consumer.');
	const ports = record(dependencies, 'derived Original ports', ['withRawFrame', 'withRecoveryFrame', 'assertCurrent'], []);
	const raw = Object.hasOwn(ports, 'withRawFrame') ? field(ports, 'withRawFrame', 'derived Original ports') : withDecodedRawOriginalV1;
	const recover = Object.hasOwn(ports, 'withRecoveryFrame') ? field(ports, 'withRecoveryFrame', 'derived Original ports') : withDecodedRawRecoveryFrameV2;
	const current = Object.hasOwn(ports, 'assertCurrent') ? field(ports, 'assertCurrent', 'derived Original ports') : undefined;
	if (typeof raw !== 'function' || typeof recover !== 'function' || current !== undefined && typeof current !== 'function') {
		throw new TypeError('Derived Original requires inert native and current capabilities.');
	}
	const encodedPorts = current ? { assertCurrent: () => Reflect.apply(current, dependencies, []) as void | Promise<void> } : {};
	return withPhotoOriginalEncodedCurrentV1({ binding, body, ...(signal === undefined ? {} : { signal }) }, async original => {
		const decodeRequest = Object.freeze({ bytes: original.bytes, signal: original.signal });
		const canonicalFlip = await (Reflect.apply(raw, dependencies, [decodeRequest, async (value: unknown) => {
			const input = record(value, 'canonical RAW Original', ['frame', 'rawFlip']);
			const rawFlip = readFlip(field(input, 'rawFlip', 'canonical RAW Original'));
			const captured = captureFrame(field(input, 'frame', 'canonical RAW Original'), 'unorm16', original.binding);
			await original.assertCurrent(); captured.check(); await opaque(captured.frame, 65535, captured.check, original.signal);
			await original.assertCurrent(); captured.check(); return rawFlip;
		}]) as Promise<number>);
		// This await is outside the word callback: the ABI 1 runtime has joined
		// worker exit and physically wiped its canonical plane before ABI 2.
		await original.assertCurrent();
		const result = await (Reflect.apply(recover, dependencies, [Object.freeze({ ...decodeRequest, profile }), async (value: unknown) => {
			const input = record(value, 'derived RAW Original', ['frame', 'rawFlip', 'profile', 'exposureScale']);
			const rawFlip = readFlip(field(input, 'rawFlip', 'derived RAW Original'));
			const selected = readProfile(field(input, 'profile', 'derived RAW Original'));
			const exposureScale = field(input, 'exposureScale', 'derived RAW Original');
			if (selected !== profile || rawFlip !== canonicalFlip || typeof exposureScale !== 'number'
				|| !Number.isFinite(exposureScale) || exposureScale < 1 || exposureScale > 65536) {
				throw new RangeError('Derived RAW profile, native orientation or applied normalization differs from its authenticated request.');
			}
			const captured = captureFrame(field(input, 'frame', 'derived RAW Original'), 'float32', original.binding);
			await original.assertCurrent(); captured.check(); await opaque(captured.frame, 1, captured.check, original.signal);
			await original.assertCurrent(); captured.check(); original.finishDecode();
			const result = await consume(Object.freeze({ frame: captured.frame as RawRecoveryPixelFrameV2, rawFlip, profile: selected, exposureScale }));
			captured.check(); await original.assertCurrent(); return result;
		}]) as Promise<Result>);
		// Derived retirement may itself yield; encoded authority and currentness
		// are checked once more after its frame and native scope have joined.
		await original.assertCurrent(); return result;
	}, encodedPorts);
}

function captureFrame(value: unknown, format: 'unorm16' | 'float32', binding: Readonly<PhotoPreviewOriginalBindingV1>) {
	const input = record(value, 'derived Original native frame', ['descriptor', 'pixels']);
	const descriptor = readPixelFrameDescriptorV1(field(input, 'descriptor', 'derived Original native frame'));
	if (descriptor.sampleFormat !== format || descriptor.primaries !== 'srgb' || descriptor.transfer !== 'linear'
		|| descriptor.width !== binding.width || descriptor.height !== binding.height) throw new RangeError('Native Original descriptor differs from its authenticated extent/profile.');
	const pixels = field(input, 'pixels', 'derived Original native frame');
	if (format === 'unorm16' ? !(pixels instanceof Uint16Array) || Object.getPrototypeOf(pixels) !== Uint16Array.prototype
		: !(pixels instanceof Float32Array) || Object.getPrototypeOf(pixels) !== Float32Array.prototype) throw new TypeError('Native Original requires its declared intrinsic sample plane.');
	const buffer = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer, length = descriptor.width * descriptor.height * (format === 'unorm16' ? 8 : 16);
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || Reflect.apply(SIZE, buffer, []) !== length
		|| Reflect.apply(OFFSET, pixels, []) !== 0 || Reflect.apply(LENGTH, pixels, []) !== length) throw new RangeError('Native Original requires exact dedicated fixed physical storage.');
	const frame = readPixelFrameV1({ descriptor, pixels }, PHOTO_ORIGINAL_DERIVED_LIMITS_CURRENT_V1);
	return { frame, check() {
		if (Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Native Original plane detached or changed during its borrow.');
	} };
}
async function opaque(frame: PixelFrameV1, alpha: number, physical: () => void, signal: AbortSignal): Promise<void> {
	const check = () => { checkRepairSignalV1(signal); physical(); }, budget = new RepairTaskBudgetV1(check); check();
	for (let index = 3; index < frame.pixels.length; index += 4) {
		if (frame.pixels[index] !== alpha) throw new RangeError('Native RAW Original must remain opaque.');
		if (budget.visit()) await budget.yield();
	}
	check();
}
function readFlip(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 7) throw new RangeError('Native RAW Original requires a bounded orientation.'); return value;
}
function readProfile(value: unknown): RawRecoveryProfileV2 {
	if (value !== 'linear-headroom-v1' && value !== 'highlight-recovery-v1') throw new RangeError('Derived Original requires an explicit supported RAW profile.'); return value;
}
