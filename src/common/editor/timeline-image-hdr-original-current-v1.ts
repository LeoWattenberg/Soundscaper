/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { prepareFramescaperHdrImageOriginalCurrentV1 } from './timeline-image-model-hdr-current-v1.ts';
import { normalizeFramescaperImageSourceV1 } from './timeline-image-model.ts';
import { encodeFramescaperImageConversionReceiptV1 } from './timeline-image-conversion-receipt-v1.ts';
import { openFramescaperImageFramePackV1 } from './timeline-image-frame-pack-v1.ts';
import { decodeFramescaperImageFramePackHeaderV1, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from './timeline-image-frame-pack-v1-layout.ts';
import { withDecodedImageHdrOriginalV1, type ImageHdrOriginalDecodedV1 } from './imaging/image-hdr-original-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, withRepairPixelFrameLifetimeV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';

export interface FramescaperHdrImageOriginalRequestCurrentV1 {
	readonly source: unknown;
	readonly read: (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
	readonly assertCurrent?: () => void | Promise<void>;
	readonly signal?: AbortSignal;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill;

/** Explicit Source5 body proof. The byte presentation cache never supplies
 * native pixels. Both encoded owners retire before the external float scope. */
export async function withFramescaperHdrImageOriginalCurrentV1<Result>(value: FramescaperHdrImageOriginalRequestCurrentV1,
	consume: (view: Readonly<ImageHdrOriginalDecodedV1>) => Result | Promise<Result>): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Frame HDR signal must be own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); };
	const { plan, reader, current, pack } = (() => { try {
		check(); if (typeof consume !== 'function') throw new TypeError('Frame HDR Original requires a scoped native consumer.');
		const input = record(value, 'Frame HDR Original request', ['source', 'read', 'assertCurrent', 'signal'], ['source', 'read']);
		const plan = prepareFramescaperHdrImageOriginalCurrentV1(field(input, 'source', 'Frame HDR Original request'));
		const reader = field(input, 'read', 'Frame HDR Original request');
		const current = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame HDR Original request') : undefined;
		if (typeof reader !== 'function' || current !== undefined && typeof current !== 'function') throw new TypeError('Frame HDR Original requires inert range/current capabilities.');
		const source = plan.source;
		const pack = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: source.kind, id: source.id, name: source.name, mimeType: source.mimeType,
			storageKey: source.storageKey, contentSha256: source.contentSha256, assetByteLength: source.assetByteLength,
			original: source.original, canonical: source.canonical, conversionReceiptSha256: source.conversionReceiptSha256 });
		check(); return { plan, reader, current, pack };
	} catch (error) { check(); throw error; } })();
	const source = plan.source;
	const fence = async () => { check(); if (current) await Reflect.apply(current, value, []); check(); };
	const read = async (offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
		await fence();
		if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1
			|| length > FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES || offset + length > pack.assetByteLength) throw new RangeError('Frame HDR range exceeds its bounded plan.');
		const bytes: unknown = await Reflect.apply(reader, value, [offset, length]); check();
		if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype
			|| ['buffer', 'byteLength', 'byteOffset', 'length'].some(key => Object.hasOwn(bytes, key)) || Reflect.apply(LENGTH, bytes, []) !== length) {
			throw new TypeError('Frame HDR pack requires an exact intrinsic byte range.');
		}
		const backing = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer;
		if (!(backing instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, backing, []) || Reflect.apply(SIZE, backing, []) === 0
			|| Number(Reflect.apply(SIZE, backing, [])) > FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES) throw new RangeError('Frame HDR range requires bounded fixed physical backing.');
		return new Uint8Array(backing, Number(Reflect.apply(OFFSET, bytes, [])), length);
	};
	return withRepairPixelFrameLifetimeV1(async owner => {
		await fence(); const expected = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'hdr-original', hdr: source.hdr });
		try {
			const header = decodeFramescaperImageFramePackHeaderV1(await read(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), pack);
			if (header.receiptByteLength !== expected.length) throw new RangeError('Frame HDR conversion receipt exceeds its exact metadata plan.');
			const opened = await openFramescaperImageFramePackV1({ source: pack, read, assertCurrent: fence, ...(signal ? { signal } : {}) });
			await fence(); const actual = encodeFramescaperImageConversionReceiptV1(opened.receipt);
			try { if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) throw new Error('Frame HDR pack receipt differs from its native source authority.'); }
			finally { actual.fill(0); }
			const original = owner.bytes(plan.originalBytes);
			for (let offset = 0; offset < original.length;) {
				const length = Math.min(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, original.length - offset);
				Reflect.apply(SET, original, [await read(header.originalOffset + offset, length), offset]); offset += length;
			}
			await fence();
			if (bytesToHex(sha256(original)) !== source.original.sha256) throw new Error('Frame HDR retained Original differs from its complete digest binding.');
			return await withDecodedImageHdrOriginalV1({ bytes: original, ...(signal ? { signal } : {}) }, async view => {
				// The codec has ended its encoded borrow before this callback. From
				// here onward all current fences are independent of encoded bytes.
				Reflect.apply(FILL, original, [0]); await fence();
				if (JSON.stringify(view.frame.descriptor) !== JSON.stringify(source.hdr.descriptor)
					|| view.pixelsSha256 !== source.hdr.pixelsSha256 || view.metadataSha256 !== source.hdr.metadataSha256) {
					throw new Error('Frame HDR native body or provenance differs from its authenticated receipt.');
				}
				const result = await consume(view); await fence(); return result;
			});
		} finally { expected.fill(0); }
	});
}
