/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { FramescaperImageSourceV4 } from './timeline-image-model-v4.ts';
import { framescaperImagePackSourceCurrentV1 } from './timeline-image-pack-source-current-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from './timeline-image-conversion-receipt-v1.ts';
import { openFramescaperImageFramePackV1 } from './timeline-image-frame-pack-v1.ts';
import { decodeFramescaperImageFramePackHeaderV1, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from './timeline-image-frame-pack-v1-layout.ts';
import { framescaperRawOriginalPixelsSha256V1 } from './timeline-image-raw-receipt-v1.ts';
import { readPixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import { probeRawSourceV1 } from './raw/raw-source-v1.ts';
import { withDecodedRawOriginalV1, type RawDecodedOriginalV1 } from './raw/libraw-runtime-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, withRepairPixelFrameLifetimeV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from './timeline-image-raw-original-plan-current-v1.ts';
export { prepareFramescaperRawImageOriginalCurrentV1 } from './timeline-image-raw-original-plan-current-v1.ts';

export interface FramescaperRawImageOriginalRequestCurrentV1 {
	readonly source: unknown;
	readonly read: (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
	readonly assertCurrent?: () => void | Promise<void>;
	readonly signal?: AbortSignal;
}
export interface FramescaperRawImageOriginalViewCurrentV1 extends RawDecodedOriginalV1 { readonly originalBytes: Uint8Array<ArrayBuffer> }
export interface FramescaperRawImageOriginalPortsCurrentV1 { readonly withRawOriginal?: typeof withDecodedRawOriginalV1 }
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteOffset')!.get!;
const SET = Uint8Array.prototype.set;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

/** Same native instance supplies orientation and words; cache pixels have no
 * authority over this proof. The caller retains the encoded Original owner. */
export async function verifyFramescaperRawOriginalViewCurrentV1(source: Readonly<FramescaperImageSourceV4>, view: Readonly<RawDecodedOriginalV1>, signal?: AbortSignal): Promise<void> {
	checkRepairSignalV1(signal);
	const input = record(view, 'Frame RAW native result', ['frame', 'rawFlip']), frame = field(input, 'frame', 'Frame RAW native result');
	const native = record(frame, 'Frame RAW native frame', ['descriptor', 'pixels']);
	const descriptor = readPixelFrameDescriptorV1(field(native, 'descriptor', 'Frame RAW native frame'));
	if (JSON.stringify(descriptor) !== JSON.stringify(source.raw.descriptor) || field(input, 'rawFlip', 'Frame RAW native result') !== source.raw.rawFlip
		|| await framescaperRawOriginalPixelsSha256V1(frame, signal) !== source.raw.pixelsSha256) {
		throw new Error('Frame RAW native words or orientation differ from their authenticated Original receipt.');
	}
	checkRepairSignalV1(signal);
}

/** Full pack authentication followed by an independently owned Original
 * copy and actual native decode. Byte frame0 is presentation cache only and
 * is never decoded, borrowed as an Original, or fed into Develop here. */
export async function withFramescaperRawImageOriginalCurrentV1<Result>(value: FramescaperRawImageOriginalRequestCurrentV1,
	consume: (view: Readonly<FramescaperRawImageOriginalViewCurrentV1>) => Result | Promise<Result>,
	dependencies: FramescaperRawImageOriginalPortsCurrentV1 = {}): Promise<Result> {
	const signalField = Object.getOwnPropertyDescriptor(value, 'signal');
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Frame RAW signal must be an own data field.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); };
	const captured = (() => { try {
		check(); if (typeof consume !== 'function') throw new TypeError('Frame RAW Original requires a scoped consumer.');
		const input = record(value, 'Frame RAW Original request', ['source', 'read', 'assertCurrent', 'signal'], ['source', 'read']);
		const plan = prepareFramescaperRawImageOriginalCurrentV1(field(input, 'source', 'Frame RAW Original request'));
		const read = field(input, 'read', 'Frame RAW Original request'), current = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame RAW Original request') : undefined;
		if (typeof read !== 'function' || current !== undefined && typeof current !== 'function') throw new TypeError('Frame RAW Original requires callable range/current ports.');
		const ports = record(dependencies, 'Frame RAW Original ports', ['withRawOriginal'], []);
		const decode = Object.hasOwn(ports, 'withRawOriginal') ? field(ports, 'withRawOriginal', 'Frame RAW Original ports') : withDecodedRawOriginalV1;
		if (typeof decode !== 'function') throw new TypeError('Frame RAW Original requires a native decode method.');
		check(); return { plan, read, current, decode };
	} catch (error) { check(); throw error; } })();
	const { source, originalBytes } = captured.plan, pack = framescaperImagePackSourceCurrentV1(source);
	const fence = async () => { check(); if (captured.current) await Reflect.apply(captured.current, value, []); check(); };
	const read = async (offset: number, length: number): Promise<Uint8Array> => {
		await fence(); const bytes: unknown = await Reflect.apply(captured.read, value, [offset, length]); check();
		if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype || Number(Reflect.apply(LENGTH, bytes, [])) !== length) throw new TypeError('Frame RAW pack requires an exact native range.');
		const backing = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer;
		if (!(backing instanceof ArrayBuffer) || RESIZABLE && Reflect.apply(RESIZABLE, backing, [])) throw new TypeError('Frame RAW range storage must be fixed and nonshared.');
		return new Uint8Array(backing, Number(Reflect.apply(OFFSET, bytes, [])), length);
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		await fence(); const expectedReceipt = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'raw-original', raw: source.raw });
		try {
			const header = decodeFramescaperImageFramePackHeaderV1(await read(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), pack);
			if (header.receiptByteLength !== expectedReceipt.byteLength) throw new RangeError('Frame RAW conversion receipt exceeds its exact metadata plan.');
			const reader = await openFramescaperImageFramePackV1({ source: pack, read }); await fence();
			const actual = encodeFramescaperImageConversionReceiptV1(reader.receipt);
			try { if (actual.length !== expectedReceipt.length || actual.some((byte, index) => byte !== expectedReceipt[index])) throw new Error('Frame RAW pack receipt differs from its native source authority.'); }
			finally { actual.fill(0); }
			const original = owner.bytes(originalBytes);
			for (let offset = 0; offset < originalBytes;) {
				const length = Math.min(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, originalBytes - offset);
				const bytes = await read(header.originalOffset + offset, length); Reflect.apply(SET, original, [bytes, offset]); offset += length;
			}
			await fence();
			const admission = probeRawSourceV1(original);
			if (!admission || admission.format !== source.original.recognizedFormat || admission.mimeType !== source.original.mimeType
				|| bytesToHex(sha256(original)) !== source.original.sha256) throw new Error('Frame RAW retained Original signature, MIME or complete SHA differs from its binding.');
			const result = await Reflect.apply(captured.decode, dependencies, [{ bytes: original, ...(signal ? { signal } : {}) }, async (view: Readonly<RawDecodedOriginalV1>) => {
				await fence(); await verifyFramescaperRawOriginalViewCurrentV1(source, view, signal); await fence();
				const result = await consume(Object.freeze({ frame: view.frame, rawFlip: view.rawFlip, originalBytes: original })); await fence();
				if (bytesToHex(sha256(original)) !== source.original.sha256) throw new Error('Frame RAW consumer changed its retained Original snapshot.'); return result;
			}]) as Result;
			await fence(); return result;
		} catch (error) { check(); throw error; }
		finally { expectedReceipt.fill(0); }
	});
}
