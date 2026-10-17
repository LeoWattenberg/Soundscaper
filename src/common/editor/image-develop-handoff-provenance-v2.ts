/* SPDX-License-Identifier: AGPL-3.0-only */

import { createImageDevelopHandoffProvenanceForProfileV1, normalizeImageDevelopHandoffProvenanceForProfileV1, imageDevelopHandoffRecipeSha256ForProfileV1,
	type ImageDevelopHandoffOriginForProfileV1, type ImageDevelopHandoffProvenanceForProfileV1 } from './internal/image-develop-handoff-provenance-kernel-v1.ts';
export type ImageDevelopHandoffOriginV2 = ImageDevelopHandoffOriginForProfileV1<'current2'>;
export type ImageDevelopHandoffProvenanceV2 = ImageDevelopHandoffProvenanceForProfileV1<'current2'>;
/** Fixed current2 recipe hashing retains every normalized declaration. */
export function imageDevelopHandoffRecipeSha256V2(value: unknown): string { return imageDevelopHandoffRecipeSha256ForProfileV1('current2', value); }
export function createImageDevelopHandoffProvenanceV2(value: unknown): Readonly<ImageDevelopHandoffProvenanceV2> { return createImageDevelopHandoffProvenanceForProfileV1('current2', value); }
export function normalizeImageDevelopHandoffProvenanceV2(value: unknown): Readonly<ImageDevelopHandoffProvenanceV2> { return normalizeImageDevelopHandoffProvenanceForProfileV1('current2', value); }
