/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS, type FramescaperImageSourceV1 } from './timeline-image-model.ts';
import { normalizeFramescaperHdrOriginalReceiptV1, type FramescaperHdrOriginalReceiptV1 } from './timeline-image-hdr-receipt-v1.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from './imaging/image-develop-state-v4.ts';
import { normalizeBrushMaskResourceReferenceV1 } from './imaging/brush-mask-resource-v1.ts';
import { normalizeImageDevelopHandoffProvenanceHdrCurrentV1, type ImageDevelopHandoffProvenanceHdrCurrentV1 } from './image-develop-handoff-provenance-hdr-current-v1.ts';
import { imageDevelopHandoffRecipeSha256CurrentV1 } from './image-develop-handoff-provenance-current-v1.ts';
import { encodeFramescaperImageConversionReceiptV1 } from './timeline-image-conversion-receipt-v1.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, IMAGE_HDR_ORIGINAL_FORMAT_V1 } from './imaging/image-hdr-original-contract-v1.ts';

export interface FramescaperHdrImageSourceCurrentV1 extends Omit<FramescaperImageSourceV1, 'schemaVersion'> {
	readonly schemaVersion: 5;
	readonly develop: Readonly<ImageDevelopStateThroughV4>;
	readonly developed: Readonly<{ width: number; height: number }>;
	readonly provenance: Readonly<ImageDevelopHandoffProvenanceHdrCurrentV1>;
	/** Native authority; the FramePack1 canonical pixels are a display cache. */
	readonly hdr: Readonly<FramescaperHdrOriginalReceiptV1>;
}
const PACK_FIELDS = ['kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256', 'assetByteLength', 'original', 'canonical', 'conversionReceiptSha256'];

/** Explicit future Source5 admission. Global Current dispatch is activated only
 * alongside its complete native-reader/archive/authoring integration. */
export function normalizeFramescaperHdrImageSourceCurrentV1(value: unknown): Readonly<FramescaperHdrImageSourceCurrentV1> {
	const input = record(value, 'Frame HDR image source', ['schemaVersion', ...PACK_FIELDS, 'develop', 'developed', 'provenance', 'hdr']);
	if (field(input, 'schemaVersion', 'Frame HDR image source') !== 5) throw new RangeError('Unsupported Frame HDR image source version.');
	const pack: Record<string, unknown> = { schemaVersion: 1 };
	for (const key of PACK_FIELDS) pack[key] = field(input, key, 'Frame HDR image source');
	const base = normalizeFramescaperImageSourceV1(pack), hdr = normalizeFramescaperHdrOriginalReceiptV1(field(input, 'hdr', 'Frame HDR image source'));
	if (base.original.mimeType !== IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 || base.original.recognizedFormat !== IMAGE_HDR_ORIGINAL_FORMAT_V1
		|| base.original.byteLength > IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes || base.assetByteLength > LIMITS.maximumAssetBytes
		|| base.canonical.frameCount !== 1 || base.canonical.hasAlpha || base.canonical.width !== hdr.descriptor.width || base.canonical.height !== hdr.descriptor.height) {
		throw new RangeError('Frame HDR source requires one bounded opaque native Original and its exact presentation extent.');
	}
	const develop = normalizeImageDevelopStateThroughV4(field(input, 'develop', 'Frame HDR image source'));
	if (develop.processVersion === 4 && develop.rawDevelopment.mode !== 'canonical') throw new RangeError('A generated HDR source requires canonical RAW processing.');
	const provenance = normalizeImageDevelopHandoffProvenanceHdrCurrentV1(field(input, 'provenance', 'Frame HDR image source'));
	if (provenance.original.sha256 !== base.original.sha256 || provenance.original.byteLength !== base.original.byteLength
		|| provenance.original.exactName.normalize('NFC') !== base.original.fileName || provenance.developSha256 !== imageDevelopHandoffRecipeSha256CurrentV1(develop)) {
		throw new Error('Frame HDR Original or unchanged recipe differs from its handoff provenance.');
	}
	if (provenance.origin.schemaFamily === 'lightscaper' && (provenance.origin.schemaVersion === 1 && develop.processVersion !== 1
		|| provenance.origin.schemaVersion === 2 && develop.processVersion >= 3)) throw new RangeError('Frame HDR recipe requires truthful Photo schema provenance.');
	for (const graph of develop.masks) for (const item of graph.inputs) normalizeBrushMaskResourceReferenceV1(item.sourceRef);
	const output = record(field(input, 'developed', 'Frame HDR image source'), 'Frame HDR natural output', ['width', 'height']);
	const width = dimension(field(output, 'width', 'Frame HDR natural output')), height = dimension(field(output, 'height', 'Frame HDR natural output'));
	if (width * height > LIMITS.maximumPixelsPerFrame) throw new RangeError('Frame HDR natural output exceeds its pixel bound.');
	return Object.freeze({ ...base, schemaVersion: 5, develop, developed: Object.freeze({ width, height }), provenance, hdr });
}

/** Scalar decode-phase admission, excluding a caller-owned resident pack.
 * The body owner retires encoded storage before entering the render consumer. */
export function prepareFramescaperHdrImageOriginalCurrentV1(value: unknown) {
	const source = normalizeFramescaperHdrImageSourceCurrentV1(value), originalBytes = source.original.byteLength;
	const expected = encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'hdr-original', hdr: source.hdr });
	try { if (bytesToHex(sha256(expected)) !== source.conversionReceiptSha256) throw new Error('Frame HDR conversion receipt differs from its exact native declaration.'); }
	finally { expected.fill(0); }
	const frameBytes = source.hdr.descriptor.width * source.hdr.descriptor.height * 16;
	// Full hostile-body extent remains bounded by the codec before receipt proof.
	const decodeWorkingBytes = BigInt(originalBytes * 2 + IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumDecodedBytes + 32 * 1024 * 1024);
	if (decodeWorkingBytes > BigInt(IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumWorkingBytes)) throw new RangeError('Frame HDR decode exceeds its bounded working phase.');
	return Object.freeze({ source, originalBytes, frameBytes, decodeWorkingBytes });
}
function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maximumDimension) throw new RangeError('Frame HDR natural dimension exceeds its bound.');
	return value;
}
