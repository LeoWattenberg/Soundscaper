/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeFramescaperImageSourceCurrentV1 } from './timeline-image-model-current-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from './timeline-image-conversion-receipt-v1.ts';

const MAXIMUM = 1024n * 1024n * 1024n, RESERVE = 32n * 1024n * 1024n;

/** Metadata-only decode phase, excluding the caller's resident pack. This
 * scalar owner has no decoder, worker, native body reader or WASM loader edge.
 * The joined worker retires before the consumer's separate render phase. */
export function prepareFramescaperRawImageOriginalCurrentV1(value: unknown) {
	const source = normalizeFramescaperImageSourceCurrentV1(value);
	if (source.schemaVersion !== 4) throw new RangeError('Frame RAW Original planning requires an explicit Source4.');
	const originalBytes = source.original.byteLength;
	const expected = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'raw-original', raw: source.raw });
	try { if (bytesToHex(sha256(expected)) !== source.conversionReceiptSha256) throw new Error('Frame RAW source conversion receipt differs from its exact native declaration.'); }
	finally { expected.fill(0); }
	const frameBytes = source.raw.descriptor.width * source.raw.descriptor.height * 8;
	// An honestly decodable hostile Original can exceed the declared extent
	// before native receipt comparison. Reserve the decoder's full output cap.
	const decodeWorkingBytes = 512n * 1024n * 1024n + BigInt(originalBytes) * 2n + 128n * 1024n * 1024n + RESERVE;
	if (decodeWorkingBytes > MAXIMUM) throw new RangeError('Frame RAW Original decode exceeds its 1 GiB working bound.');
	return Object.freeze({ source, originalBytes, frameBytes, decodeWorkingBytes });
}
