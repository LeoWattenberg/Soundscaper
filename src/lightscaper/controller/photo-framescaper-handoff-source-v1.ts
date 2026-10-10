/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../../common/editor/image-develop-handoff-provenance-v1.ts';
import { defaultImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-state-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../../common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2, type FramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';

/** Scalar projection only. The archive reader must authenticate the unchanged
 * Source1 pack and actual project/clip membership before using this result,
 * then verify the retained original's signature and canonical native pixels.
 * The importer preserved only its stored NFC filename; earlier spelling is
 * unavailable. MIME is derived from the format declaration, not its File.type
 * hint. Neither declaration nor this projection grants body authority. */
export function promotePhotoFramescaperImageSourceV1(value: unknown): Readonly<FramescaperImageSourceV2> {
	const label = 'Photo ordinary Frame image', input = record(value, label, ['source', 'origin']);
	const source = normalizeFramescaperImageSourceV1(field(input, 'source', label)), develop = defaultImageDevelopStateV1();
	const provenance = createImageDevelopHandoffProvenanceV1({ origin: field(input, 'origin', label),
		original: { exactName: source.original.fileName, sha256: source.original.sha256, byteLength: source.original.byteLength }, develop });
	if (provenance.origin.schemaFamily !== 'framescaper' || provenance.origin.sourceId !== source.id) {
		throw new RangeError('Ordinary Frame image promotion requires matching Frame source provenance.');
	}
	return normalizeFramescaperImageSourceV2({ ...source, schemaVersion: 2,
		original: { ...source.original, mimeType: `image/${source.original.recognizedFormat}` }, develop,
		developed: { width: source.canonical.width, height: source.canonical.height }, provenance });
}
