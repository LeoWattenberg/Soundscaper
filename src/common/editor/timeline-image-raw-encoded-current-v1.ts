/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { framescaperRawOriginalPixelsSha256V1 } from './timeline-image-raw-receipt-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from './timeline-image-conversion-receipt-v1.ts';
import { openFramescaperImageFramePackV1 } from './timeline-image-frame-pack-v1.ts';
import { decodeFramescaperImageFramePackHeaderV1, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from './timeline-image-frame-pack-v1-layout.ts';
import { readPixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, withRepairPixelFrameLifetimeV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';
import { probeRawSourceV1 } from './raw/raw-source-v1.ts';
import type { RawDecodedOriginalV1 } from './raw/libraw-runtime-v1.ts';
import { prepareFramescaperRawImageEncodedCurrentV1, type FramescaperRawImageBindingCurrentV1 } from './timeline-image-raw-encoded-plan-current-v1.ts';
export { prepareFramescaperRawImageEncodedCurrentV1 } from './timeline-image-raw-encoded-plan-current-v1.ts';
export type { FramescaperRawImageBindingCurrentV1 } from './timeline-image-raw-encoded-plan-current-v1.ts';

export interface FramescaperRawImageEncodedRequestCurrentV1 {
	readonly binding: unknown;
	readonly read: (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
	readonly assertCurrent?: () => void | Promise<void>;
	readonly signal?: AbortSignal;
}
export interface FramescaperRawImageEncodedViewCurrentV1 {
	readonly binding: Readonly<FramescaperRawImageBindingCurrentV1>;
	readonly originalBytes: Uint8Array<ArrayBuffer>;
	readonly assertCurrent: () => Promise<void>;
	readonly signal: AbortSignal | undefined;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = Uint8Array.prototype.set;

/** Verify actual ABI1 words/flip without ever treating cache frame0 as native
 * authority. The native word hash remains the existing rgba16be contract. */
export async function verifyFramescaperRawOriginalBindingViewCurrentV1(binding: Readonly<FramescaperRawImageBindingCurrentV1>,
	view: Readonly<RawDecodedOriginalV1>, signal?: AbortSignal): Promise<void> {
	checkRepairSignalV1(signal);
	const packet = record(view, 'Frame RAW native result', ['frame', 'rawFlip']);
	const input = record(field(packet, 'frame', 'Frame RAW native result'), 'Frame RAW native frame', ['descriptor', 'pixels']);
	const descriptor = readPixelFrameDescriptorV1(field(input, 'descriptor', 'Frame RAW native frame'));
	if (JSON.stringify(descriptor) !== JSON.stringify(binding.raw.descriptor) || field(packet, 'rawFlip', 'Frame RAW native result') !== binding.raw.rawFlip) {
		throw new Error('Frame RAW native extent or orientation differs from its authenticated receipt.');
	}
	const pixels = field(input, 'pixels', 'Frame RAW native frame');
	if (!(pixels instanceof Uint16Array) || Object.getPrototypeOf(pixels) !== Uint16Array.prototype) throw new TypeError('Frame RAW canonical proof requires intrinsic native words.');
	const buffer = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer, bytes = descriptor.width * descriptor.height * 8;
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || Reflect.apply(SIZE, buffer, []) !== bytes
		|| Reflect.apply(LENGTH, pixels, []) !== bytes || Reflect.apply(OFFSET, pixels, []) !== 0) throw new RangeError('Frame RAW native proof requires exact dedicated storage.');
	if (await framescaperRawOriginalPixelsSha256V1({ descriptor, pixels }, signal) !== binding.raw.pixelsSha256) {
		throw new Error('Frame RAW native words differ from their authenticated Original receipt.');
	}
	checkRepairSignalV1(signal);
}

/** Full immutable pack/receipt authentication and one owned encoded snapshot.
 * This owner deliberately has no native decode edge. Canonical and derived
 * callers decide which sequential native proof scopes consume its bytes. */
export async function withFramescaperRawImageEncodedOriginalCurrentV1<Result>(value: FramescaperRawImageEncodedRequestCurrentV1,
	consume: (view: Readonly<FramescaperRawImageEncodedViewCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Frame RAW encoded signal must be own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); };
	check(); if (typeof consume !== 'function') throw new TypeError('Frame RAW encoded Original requires a scoped consumer.');
	const input = record(value, 'Frame RAW encoded request', ['binding', 'read', 'assertCurrent', 'signal'], ['binding', 'read']);
	const plan = prepareFramescaperRawImageEncodedCurrentV1(field(input, 'binding', 'Frame RAW encoded request'));
	const reader = field(input, 'read', 'Frame RAW encoded request');
	const current = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame RAW encoded request') : undefined;
	if (typeof reader !== 'function' || current !== undefined && typeof current !== 'function') throw new TypeError('Frame RAW encoded Original requires inert range/current capabilities.');
	const { pack, raw } = plan.binding;
	let original: Uint8Array<ArrayBuffer> | undefined, originalBacking: ArrayBuffer | undefined;
	const authenticate = () => {
		check();
		if (!originalBacking || Reflect.apply(SIZE, originalBacking, []) !== plan.originalBytes) throw new TypeError('Frame RAW encoded Original detached or changed.');
		if (bytesToHex(sha256(new Uint8Array(originalBacking))) !== pack.original.sha256) throw new Error('Frame RAW consumer changed its retained Original snapshot.');
	};
	const fence = async () => { check(); if (current) await Reflect.apply(current, value, []); check(); if (original) authenticate(); };
	const read = async (offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
		await fence(); const bytes: unknown = await Reflect.apply(reader, value, [offset, length]); check();
		if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype || Reflect.apply(LENGTH, bytes, []) !== length) {
			throw new TypeError('Frame RAW pack requires an exact intrinsic byte range.');
		}
		const buffer = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer;
		if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, [])
			|| Number(Reflect.apply(SIZE, buffer, [])) > Math.max(pack.assetByteLength, FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES)) {
			throw new RangeError('Frame RAW range requires bounded fixed nonshared physical backing.');
		}
		return new Uint8Array(buffer, Number(Reflect.apply(OFFSET, bytes, [])), length);
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		await fence(); const expected = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'raw-original', raw });
		try {
			const header = decodeFramescaperImageFramePackHeaderV1(await read(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), pack);
			if (header.receiptByteLength !== expected.byteLength) throw new RangeError('Frame RAW conversion receipt exceeds its exact metadata plan.');
			const opened = await openFramescaperImageFramePackV1({ source: pack, read }); await fence();
			const actual = encodeFramescaperImageConversionReceiptV1(opened.receipt);
			try { if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) throw new Error('Frame RAW pack receipt differs from its native source authority.'); }
			finally { actual.fill(0); }
			const copied = owner.bytes(plan.originalBytes);
			for (let offset = 0; offset < plan.originalBytes;) {
				const length = Math.min(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, plan.originalBytes - offset);
				Reflect.apply(SET, copied, [await read(header.originalOffset + offset, length), offset]); offset += length;
			}
			original = copied; originalBacking = copied.buffer; authenticate();
			const admission = probeRawSourceV1(copied);
			if (!admission || admission.format !== pack.original.recognizedFormat || admission.mimeType !== pack.original.mimeType) {
				throw new Error('Frame RAW retained Original signature/MIME differs from its binding.');
			}
			await fence(); const result = await consume(Object.freeze({ binding: plan.binding, originalBytes: copied, signal, assertCurrent: fence }));
			await fence(); return result;
		} finally { expected.fill(0); }
	});
}
