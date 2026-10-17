/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1, IMAGE_HDR_ORIGINAL_FORMAT_V1 } from './imaging/image-hdr-original-profile-v1.ts';

export type FramescaperHdrOriginalDescriptorV1 = Readonly<PixelFrameDescriptorV1 & {
	readonly sampleFormat: 'float32'; readonly primaries: 'srgb'; readonly transfer: 'linear';
}>;
export interface FramescaperHdrOriginalReceiptV1 {
	readonly schemaVersion: 1;
	readonly format: 'lightscaper-hdr';
	readonly bodyVersion: 1;
	readonly descriptor: FramescaperHdrOriginalDescriptorV1;
	readonly pixelEncoding: 'rgb32f-le';
	readonly pixelsSha256: string;
	readonly metadataSha256: string;
}

/** Closed native declarations, distinct from a byte cache or RAW decoder.
 * Only the body reader grants evidence for these descriptor and hash facts. */
export function normalizeFramescaperHdrOriginalReceiptV1(value: unknown): Readonly<FramescaperHdrOriginalReceiptV1> {
	const input = record(value, 'Frame HDR Original receipt', ['schemaVersion', 'format', 'bodyVersion', 'descriptor', 'pixelEncoding', 'pixelsSha256', 'metadataSha256']);
	if (field(input, 'schemaVersion', 'Frame HDR Original receipt') !== 1 || field(input, 'bodyVersion', 'Frame HDR Original receipt') !== 1
		|| field(input, 'format', 'Frame HDR Original receipt') !== IMAGE_HDR_ORIGINAL_FORMAT_V1
		|| field(input, 'pixelEncoding', 'Frame HDR Original receipt') !== 'rgb32f-le') throw new RangeError('Unsupported Frame HDR native body or pixel encoding.');
	const descriptor = planPixelFrameV1(field(input, 'descriptor', 'Frame HDR Original receipt'), {
		maximumSidePixels: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumSide, maximumPixels: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumPixels,
		maximumBytes: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumDecodedBytes,
	}).descriptor;
	if (descriptor.sampleFormat !== 'float32' || descriptor.primaries !== 'srgb' || descriptor.transfer !== 'linear') {
		throw new RangeError('Frame HDR Original requires linear sRGB Float32 samples.');
	}
	return Object.freeze({ schemaVersion: 1, format: IMAGE_HDR_ORIGINAL_FORMAT_V1, bodyVersion: 1,
		descriptor: descriptor as FramescaperHdrOriginalDescriptorV1, pixelEncoding: 'rgb32f-le',
		pixelsSha256: digest(field(input, 'pixelsSha256', 'Frame HDR Original receipt')),
		metadataSha256: digest(field(input, 'metadataSha256', 'Frame HDR Original receipt')) });
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Frame HDR receipt requires a lowercase SHA256.');
	return value;
}
