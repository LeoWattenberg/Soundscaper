/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoCatalogRootV1 } from '../catalog/catalog-root.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDocumentV1 } from '../catalog/types.ts';
import { id, name } from '../catalog/value-validation.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

/** The caller owns the catalog lease. Legacy File import retains notice/skip;
 * receive's strict plan refuses every unmapped keyword before catalog writes. */
export async function resolvePhotoImportKeywordsV1(catalog: Pick<PhotoLibrarySessionPortsV2['catalog'], 'loadCatalog' | 'saveCatalog'>, catalogId: string, outcome: Readonly<{ photo: Pick<PhotoDocumentV1, 'keywordIds'>; keywordNames: readonly string[] }>, createId: () => string, signal: AbortSignal, strict = false) {
	const root = await catalog.loadCatalog(catalogId);
	if (!root) throw new ReferenceError('Photo catalog is missing.');
	const keywords = [...root.keywords], ids = [...outcome.photo.keywordIds];
	const encoder = new TextEncoder();
	// Reserve both keyword-definition and photo-publication revision growth.
	let rootBytes = encoder.encode(JSON.stringify({ ...root, revision: root.revision + 2, photoCount: root.photoCount + 1 })).byteLength;
	let notice = false;
	for (const candidate of outcome.keywordNames) {
		let label: string;
		try { label = name(candidate, 'imported keyword'); }
		catch { if (strict) throw new RangeError('An imported keyword cannot be mapped to the selected catalog.'); notice = true; continue; }
		const existing = keywords.find(node => node.name === label && node.parentId === null);
		if (existing && ids.includes(existing.id)) continue;
		if (ids.length >= LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships) { if (strict) throw new RangeError('Imported keyword capacity is exhausted.'); notice = true; continue; }
		if (existing) { if (!ids.includes(existing.id)) ids.push(existing.id); continue; }
		if (keywords.length >= LIGHTSCAPER_CATALOG_LIMITS.maximumKeywords) { if (strict) throw new RangeError('Imported keyword capacity is exhausted.'); notice = true; continue; }
		const keyword = Object.freeze({ id: id(createId(), 'keyword ID'), name: label, parentId: null });
		const additionalBytes = encoder.encode(JSON.stringify(keyword)).byteLength + (keywords.length ? 1 : 0);
		if (rootBytes + additionalBytes > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) { if (strict) throw new RangeError('Imported keyword capacity is exhausted.'); notice = true; continue; }
		rootBytes += additionalBytes;
		keywords.push(keyword); ids.push(keyword.id);
	}
	if (strict) {
		signal.throwIfAborted();
		const planned = normalizePhotoCatalogRootV1({ ...root, keywords,
			revision: root.revision + (keywords.length === root.keywords.length ? 1 : 2), photoCount: root.photoCount + 1 });
		if (encoder.encode(JSON.stringify(planned)).byteLength > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) throw new RangeError('Imported keyword plan exceeds its document capacity.');
	}
	if (keywords.length !== root.keywords.length) await catalog.saveCatalog(normalizePhotoCatalogRootV1({ ...root, keywords }), root.revision, { signal });
	return { ids, notice };
}
