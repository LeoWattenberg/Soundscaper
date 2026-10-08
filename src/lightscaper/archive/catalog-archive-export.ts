/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoCatalogPackInput } from './catalog-pack.ts';
import { PhotoCatalogArchiveIdentityGuard, normalizePhotoCatalogArchiveV1, serializePhotoCatalogArchiveV1, type PhotoCatalogArchiveDocumentV1 } from './catalog-archive-contract.ts';
import { writePhotoCatalogArchive, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer.ts';

export { maximumPhotoCatalogStreamingOutputBytesV1 } from './catalog-archive-capacity.ts';
export type { PhotoCatalogArchiveExportOptions } from './catalog-archive-writer.ts';
export type PhotoCatalogArchiveExportResult = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV1>;

export async function exportPhotoCatalogArchiveV1(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	options: PhotoCatalogArchiveExportOptions = {}): Promise<PhotoCatalogArchiveExportResult> {
	const root = validateLightscaperDocumentV1(rootValue);
	if (root.kind !== 'photo-catalog') throw new TypeError('Photo archive export requires a catalog root.');
	return writePhotoCatalogArchive(root, photos, new PhotoCatalogArchiveIdentityGuard(root), async packs => {
		const document = normalizePhotoCatalogArchiveV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
			kind: 'photo-catalog-archive', id: root.id, title: root.name, catalog: root, packs });
		return { document, text: serializePhotoCatalogArchiveV1(document), schemaVersion: 1 };
	}, options);
}
