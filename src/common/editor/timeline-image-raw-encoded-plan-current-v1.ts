/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1, type FramescaperImageSourceV1 } from './timeline-image-model.ts';
import { normalizeFramescaperRawOriginalReceiptV1, type FramescaperRawOriginalReceiptV1 } from './timeline-image-raw-receipt-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from './timeline-image-conversion-receipt-v1.ts';

export interface FramescaperRawImageBindingCurrentV1 {
	readonly pack: Readonly<FramescaperImageSourceV1>;
	readonly raw: Readonly<FramescaperRawOriginalReceiptV1>;
}
const MIB = 1024n * 1024n, MAXIMUM = 1024n * MIB;

/** Codec-only scalar admission, independent of saved Develop/provenance and
 * every Blob, range reader, worker or decoder. The outer owner separately
 * admits the full Current source and charges its resident pack. ABI1's native
 * receipt remains independent of derived processing. */
export function prepareFramescaperRawImageEncodedCurrentV1(value: unknown) {
	const input = record(value, 'Frame RAW codec binding', ['pack', 'raw']);
	const pack = normalizeFramescaperImageSourceV1(field(input, 'pack', 'Frame RAW codec binding'));
	const raw = normalizeFramescaperRawOriginalReceiptV1(field(input, 'raw', 'Frame RAW codec binding'));
	if (pack.assetByteLength > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumAssetBytes || pack.canonical.frameCount !== 1 || pack.canonical.hasAlpha
		|| pack.canonical.width !== raw.descriptor.width || pack.canonical.height !== raw.descriptor.height
		|| pack.original.byteLength > 64 * 1024 * 1024
		|| (pack.original.recognizedFormat !== 'dng' || pack.original.mimeType !== 'image/x-adobe-dng')
			&& (pack.original.recognizedFormat !== 'crw' || pack.original.mimeType !== 'image/x-canon-crw')) {
		throw new RangeError('Frame RAW codec requires bounded static opaque native geometry and exact RAW MIME/signature metadata.');
	}
	const binding = Object.freeze({ pack, raw }), expected = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'raw-original', raw });
	try { if (bytesToHex(sha256(expected)) !== pack.conversionReceiptSha256) throw new Error('Frame RAW codec receipt differs from its exact native declaration.'); }
	finally { expected.fill(0); }
	const originalBytes = pack.original.byteLength, frameBytes = raw.descriptor.width * raw.descriptor.height * 8;
	// Actual hostile output can reach the decoder's native maximum before the
	// declared extent is checked. ABI1 retires before ABI2; use the latter peak.
	const decodeWorkingBytes = 512n * MIB + 256n * MIB + 2n * BigInt(originalBytes) + 32n * MIB;
	if (decodeWorkingBytes > MAXIMUM) throw new RangeError('Frame RAW codec decode exceeds its one-GiB phase bound.');
	return Object.freeze({ binding, originalBytes, frameBytes, derivedFrameBytes: frameBytes * 2, decodeWorkingBytes });
}
