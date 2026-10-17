/* SPDX-License-Identifier: AGPL-3.0-only */

// Persisted format identity and bounded phase facts; no provenance or byte authority.
export const IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 = 'image/x-lightscaper-hdr' as const;
export const IMAGE_HDR_ORIGINAL_FORMAT_V1 = 'lightscaper-hdr' as const;
export const IMAGE_HDR_ORIGINAL_SUFFIX_V1 = '.lshdr' as const;
export const IMAGE_HDR_ORIGINAL_MAGIC_V1 = 'LSCHDRF1' as const;
export const IMAGE_HDR_ORIGINAL_LIMITS_V1 = Object.freeze({ headerBytes: 64, maximumMetadataBytes: 65_536,
	maximumEncodedBytes: 196 * 1024 * 1024, maximumSide: 8192, maximumPixels: 16_777_216,
	maximumDecodedBytes: 268_435_456, maximumWorkingBytes: 768 * 1024 * 1024, maximumInputs: 9, maximumInputOriginalBytes: 64 * 1024 * 1024 });
