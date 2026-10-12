/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField } from './closed-domain-value.ts';
import { normalizeImageDevelopHandoffProvenanceV1, type ImageDevelopHandoffProvenanceV1 } from './image-develop-handoff-provenance-v1.ts';
import { normalizeImageDevelopHandoffProvenanceV2, imageDevelopHandoffRecipeSha256V2, type ImageDevelopHandoffProvenanceV2 } from './image-develop-handoff-provenance-v2.ts';

export type ImageDevelopHandoffProvenanceCurrentV1 = ImageDevelopHandoffProvenanceV1 | ImageDevelopHandoffProvenanceV2;
export function normalizeImageDevelopHandoffProvenanceCurrentV1(value: unknown): Readonly<ImageDevelopHandoffProvenanceCurrentV1> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Image provenance requires an own version.');
	const version = readClosedDomainField(value as Readonly<Record<string, unknown>>, 'schemaVersion', 'image provenance identity');
	if (version === 1) return normalizeImageDevelopHandoffProvenanceV1(value);
	if (version === 2) return normalizeImageDevelopHandoffProvenanceV2(value);
	throw new RangeError('Unsupported image handoff provenance version.');
}
export function imageDevelopHandoffRecipeSha256CurrentV1(value: unknown): string { return imageDevelopHandoffRecipeSha256V2(value); }
