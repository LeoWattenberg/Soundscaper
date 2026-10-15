/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperImageSourceCurrentV1 } from './timeline-image-model-current-v1.ts';
import { normalizeFramescaperImageSourceV1, type FramescaperImageSourceV1 } from './timeline-image-model.ts';

/** Explicit immutable transport projection. Recipe/native RAW declarations
 * never masquerade as fields of the permanent Source1 pack contract. */
export function framescaperImagePackSourceCurrentV1(value: unknown): Readonly<FramescaperImageSourceV1> {
	const source = normalizeFramescaperImageSourceCurrentV1(value);
	return normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: source.kind, id: source.id, name: source.name, mimeType: source.mimeType,
		storageKey: source.storageKey, contentSha256: source.contentSha256, assetByteLength: source.assetByteLength,
		original: source.original, canonical: source.canonical, conversionReceiptSha256: source.conversionReceiptSha256 });
}
