/* SPDX-License-Identifier: AGPL-3.0-only */

import { createImageDevelopHandoffProvenanceForProfileV1, normalizeImageDevelopHandoffProvenanceForProfileV1, imageDevelopHandoffRecipeSha256ForProfileV1,
	type ImageDevelopHandoffOriginForProfileV1, type ImageDevelopHandoffProvenanceForProfileV1 } from './internal/image-develop-handoff-provenance-kernel-v1.ts';
export type ImageDevelopHandoffOriginV1 = ImageDevelopHandoffOriginForProfileV1<'legacy1'>;
export type ImageDevelopHandoffProvenanceV1 = ImageDevelopHandoffProvenanceForProfileV1<'legacy1'>;
/** Fixed legacy1 recipe hashing retains every normalized declaration. */
export function imageDevelopHandoffRecipeSha256V1(value: unknown): string { return imageDevelopHandoffRecipeSha256ForProfileV1('legacy1', value); }
export function createImageDevelopHandoffProvenanceV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceV1> { return createImageDevelopHandoffProvenanceForProfileV1('legacy1', value); }
export function normalizeImageDevelopHandoffProvenanceV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceV1> { return normalizeImageDevelopHandoffProvenanceForProfileV1('legacy1', value); }
