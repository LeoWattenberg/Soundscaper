/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { RepairTaskBudgetV1, captureRepairSignalV1, checkRepairSignalV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';
import { readPixelFrameDescriptorV1, readPixelFrameV1 } from './imaging/pixel-frame-contract-v1.ts';
import { withDecodedRawOriginalV1, type RawDecodedOriginalV1 } from './raw/libraw-runtime-v1.ts';
import { withDecodedRawRecoveryFrameV2, type RawRecoveryFrameV2, type RawRecoveryPixelFrameV2, type RawRecoveryProfileV2 } from './raw/libraw-runtime-v2.ts';
import { prepareFramescaperRawImageEncodedCurrentV1, withFramescaperRawImageEncodedOriginalCurrentV1, verifyFramescaperRawOriginalBindingViewCurrentV1,
	type FramescaperRawImageEncodedRequestCurrentV1 } from './timeline-image-raw-encoded-current-v1.ts';

export interface FramescaperRawImageDerivedRequestCurrentV1 extends FramescaperRawImageEncodedRequestCurrentV1 {
	readonly profile: RawRecoveryProfileV2;
}
export interface FramescaperRawImageDerivedPortsCurrentV1 {
	readonly withRawOriginal?: typeof withDecodedRawOriginalV1;
	readonly withRecoveryFrame?: typeof withDecodedRawRecoveryFrameV2;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 256 * 1024 * 1024 });

/** The outer Frame owner admits its complete Current recipe. This codec needs
 * only strict immutable pack+ABI1 receipt authority, and cannot counterfeit a
 * legacy Develop/provenance record to make a newer recipe fit an old parser. */
export async function withFramescaperRawImageDerivedCurrentV1<Result>(value: unknown,
	consume: (view: Readonly<RawRecoveryFrameV2>) => Result | Promise<Result>,
	dependencies: Readonly<FramescaperRawImageDerivedPortsCurrentV1> = {}): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Frame RAW derived signal must be own data.');
	const signal = captureRepairSignalV1(ownSignal?.value);
	const input = record(value, 'Frame RAW derived request', ['binding', 'profile', 'read', 'assertCurrent', 'signal'], ['binding', 'profile', 'read']);
	const profile = readProfile(field(input, 'profile', 'Frame RAW derived request'));
	const { binding } = prepareFramescaperRawImageEncodedCurrentV1(field(input, 'binding', 'Frame RAW derived request'));
	if (binding.raw.descriptor.width < 16 || binding.raw.descriptor.height < 16) throw new RangeError('Frame RAW recovery requires at least sixteen pixels per side.');
	const read = field(input, 'read', 'Frame RAW derived request');
	const current = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame RAW derived request') : undefined;
	if (typeof consume !== 'function' || typeof read !== 'function' || current !== undefined && typeof current !== 'function') {
		throw new TypeError('Frame RAW derived Original requires scoped/range/current capabilities.');
	}
	const ports = record(dependencies, 'Frame RAW derived ports', ['withRawOriginal', 'withRecoveryFrame'], []);
	const raw = Object.hasOwn(ports, 'withRawOriginal') ? field(ports, 'withRawOriginal', 'Frame RAW derived ports') : withDecodedRawOriginalV1;
	const recover = Object.hasOwn(ports, 'withRecoveryFrame') ? field(ports, 'withRecoveryFrame', 'Frame RAW derived ports') : withDecodedRawRecoveryFrameV2;
	if (typeof raw !== 'function' || typeof recover !== 'function') throw new TypeError('Frame RAW derived Original requires inert native decode capabilities.');
	return withFramescaperRawImageEncodedOriginalCurrentV1({ binding,
		read: (offset, length) => Reflect.apply(read, value, [offset, length]) as Uint8Array | Promise<Uint8Array>,
		...(current ? { assertCurrent: () => Reflect.apply(current, value, []) as void | Promise<void> } : {}), ...(signal ? { signal } : {}) }, async original => {
		const request = Object.freeze({ bytes: original.originalBytes, ...(signal ? { signal } : {}) });
		await Reflect.apply(raw, dependencies, [request, async (view: Readonly<RawDecodedOriginalV1>) => {
			await original.assertCurrent(); await verifyFramescaperRawOriginalBindingViewCurrentV1(original.binding, view, signal); await original.assertCurrent();
		}]);
		// Full canonical retirement precedes this second private native instance.
		await original.assertCurrent();
		const result = await (Reflect.apply(recover, dependencies, [Object.freeze({ ...request, profile }), async (value: unknown) => {
			const packet = record(value, 'Frame RAW recovery result', ['frame', 'rawFlip', 'profile', 'exposureScale']);
			const rawFlip = field(packet, 'rawFlip', 'Frame RAW recovery result'), selected = readProfile(field(packet, 'profile', 'Frame RAW recovery result'));
			const exposureScale = field(packet, 'exposureScale', 'Frame RAW recovery result');
			if (rawFlip !== original.binding.raw.rawFlip || selected !== profile || typeof exposureScale !== 'number'
				|| !Number.isFinite(exposureScale) || exposureScale < 1 || exposureScale > 65536) throw new RangeError('Frame RAW recovery orientation/profile/normalization differs from its authenticated request.');
			const source = record(field(packet, 'frame', 'Frame RAW recovery result'), 'Frame RAW recovery frame', ['descriptor', 'pixels']);
			const descriptor = readPixelFrameDescriptorV1(field(source, 'descriptor', 'Frame RAW recovery frame'));
			if (descriptor.width !== original.binding.raw.descriptor.width || descriptor.height !== original.binding.raw.descriptor.height
				|| descriptor.sampleFormat !== 'float32' || descriptor.primaries !== 'srgb' || descriptor.transfer !== 'linear') throw new RangeError('Frame RAW recovery frame differs from its canonical native extent.');
			const pixels = field(source, 'pixels', 'Frame RAW recovery frame');
			if (!(pixels instanceof Float32Array) || Object.getPrototypeOf(pixels) !== Float32Array.prototype) throw new TypeError('Frame RAW recovery requires native Float32.');
			const buffer = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer, length = descriptor.width * descriptor.height * 16;
			if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || Reflect.apply(SIZE, buffer, []) !== length
				|| Reflect.apply(LENGTH, pixels, []) !== length || Reflect.apply(OFFSET, pixels, []) !== 0) throw new RangeError('Frame RAW recovery requires exact dedicated physical storage.');
			const frame = readPixelFrameV1({ descriptor, pixels }, LIMITS) as RawRecoveryPixelFrameV2;
			const physical = () => {
				checkRepairSignalV1(signal); if (Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Frame RAW recovery plane detached during its borrow.');
			}, budget = new RepairTaskBudgetV1(physical);
			for (let index = 3; index < pixels.length; index += 4) {
				if (pixels[index] !== 1) throw new RangeError('Frame RAW recovery must remain opaque.');
				if (budget.visit()) await budget.yield();
			}
			await original.assertCurrent(); checkRepairSignalV1(signal);
			if (Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Frame RAW recovery plane detached before consumption.');
			const result = await consume(Object.freeze({ frame, rawFlip: original.binding.raw.rawFlip, profile: selected, exposureScale }));
			await original.assertCurrent(); return result;
		}]) as Promise<Result>);
		await original.assertCurrent(); return result;
	});
}
function readProfile(value: unknown): RawRecoveryProfileV2 {
	if (value !== 'linear-headroom-v1' && value !== 'highlight-recovery-v1') throw new RangeError('Frame RAW derived Original requires an explicit supported profile.'); return value;
}
