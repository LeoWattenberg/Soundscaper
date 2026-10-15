/* SPDX-License-Identifier: AGPL-3.0-only */
import { createImageDevelopHandoffProvenanceForProfileV1, normalizeImageDevelopHandoffProvenanceForProfileV1,
	type ImageDevelopHandoffProvenanceForProfileV1 } from './internal/image-develop-handoff-provenance-kernel-v1.ts';

export type ImageDevelopHandoffProvenanceHdrCurrentV1 = ImageDevelopHandoffProvenanceForProfileV1<'current-hdr4'>;

/** Named Source5 transport policy. The wire remains2, while the caller must
 * separately prove the native HDR body. Other provenance policies keep64MiB. */
export function normalizeImageDevelopHandoffProvenanceHdrCurrentV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceHdrCurrentV1> {
	return normalizeImageDevelopHandoffProvenanceForProfileV1('current-hdr4', value);
}
export function createImageDevelopHandoffProvenanceHdrCurrentV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceHdrCurrentV1> {
	return createImageDevelopHandoffProvenanceForProfileV1('current-hdr4', value);
}
