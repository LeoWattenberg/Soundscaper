/* SPDX-License-Identifier: AGPL-3.0-only */

import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV3, serializePhotoCatalogArchiveV3,
	type PhotoCatalogArchiveDocumentV3 } from './catalog-archive-contract-v3.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { createPhotoCatalogCompanionWriter } from './catalog-archive-companion-packs.ts';
import { maximumPhotoCatalogStreamingOutputBytesV3 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchive, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer.ts';
import type { PhotoCatalogPackInput } from './catalog-pack.ts';

export interface PhotoCatalogArchiveExportOptionsV3 extends PhotoCatalogArchiveExportOptions {
	/** Borrowed live sources settle their final inventory fence before output close. */
	readonly verifySource?: () => Promise<void>;
}
export type PhotoCatalogArchiveExportResultV3 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV3>;

export async function exportPhotoCatalogArchiveV3(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>,
	options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveExportResultV3> {
	const root = readValidatedPhotoCatalogRootV1(rootValue);
	const state = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	const identity = new PhotoCatalogArchiveIdentityLedger();
	const writeCompanions = createPhotoCatalogCompanionWriter(root, stacks, state, definitions, identity, options.signal);
	const verifySource = options.verifySource;
	if (verifySource !== undefined && typeof verifySource !== 'function') throw new TypeError('A source verification callback is required.');
	return writePhotoCatalogArchive(root, photos, new PhotoCatalogArchiveIdentityGuard(root, identity), async (packs, writer) => {
		const companions = await writeCompanions(writer);
		const document = normalizePhotoCatalogArchiveV3({ schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-catalog-archive',
			id: root.id, title: root.name, catalog: root, packs, ...companions });
		return { document, text: serializePhotoCatalogArchiveV3(document), schemaVersion: 3, beforeFinish: verifySource };
	}, options, maximumPhotoCatalogStreamingOutputBytesV3());
}
