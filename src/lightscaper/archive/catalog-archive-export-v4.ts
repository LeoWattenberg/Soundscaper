/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, PHOTO_DEVELOP_PRESET_PACK_ENCODING } from '../../common/editor/scape-photo-develop-preset-pack.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { normalizePhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV4, serializePhotoCatalogArchiveV4,
	type PhotoCatalogArchiveDocumentV4, type PhotoCatalogArchiveDevelopPresetPackV4 } from './catalog-archive-contract-v4.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { createPhotoCatalogCompanionWriter } from './catalog-archive-companion-packs.ts';
import { maximumPhotoCatalogStreamingOutputBytesV3 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchive, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer.ts';
import type { PhotoCatalogArchiveExportOptionsV3 } from './catalog-archive-export-v3.ts';
import type { PhotoCatalogPackInput } from './catalog-pack.ts';
import { encodePhotoDevelopPresetPackV1 } from './develop-preset-pack-v1.ts';

export type PhotoCatalogArchiveExportResultV4 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV4>;

/** One bounded preset body is admitted before borrowed originals or output; all other pack contracts stay unchanged. */
export async function exportPhotoCatalogArchiveV4(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>, rowValue: unknown,
	options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveExportResultV4> {
	const root = readValidatedPhotoCatalogRootV1(rootValue);
	const state = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	const row = rowValue === null ? null : normalizePhotoDevelopPresetRowV1(rowValue, root.id);
	const identity = new PhotoCatalogArchiveIdentityLedger();
	const writeCompanions = createPhotoCatalogCompanionWriter(root, stacks, state, definitions, identity, options.signal);
	const verifySource = options.verifySource;
	if (verifySource !== undefined && typeof verifySource !== 'function') throw new TypeError('A source verification callback is required.');
	return writePhotoCatalogArchive(root, photos, new PhotoCatalogArchiveIdentityGuard(root, identity), async (packs, writer) => {
		const companions = await writeCompanions(writer);
		let developPresetPack: PhotoCatalogArchiveDevelopPresetPackV4 | null = null;
		if (row) {
			developPresetPack = Object.freeze({ id: 'develop-presets', entry: 'assets/develop-presets-v1.bin', revision: row.revision, presetCount: row.presets.length });
			await writer.addPack({ sourceId: developPresetPack.id, entry: developPresetPack.entry,
				kind: PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, encoding: PHOTO_DEVELOP_PRESET_PACK_ENCODING }, encodePhotoDevelopPresetPackV1(row, root.id, { signal: options.signal }));
		}
		const document = normalizePhotoCatalogArchiveV4({ schemaFamily: 'lightscaper', schemaVersion: 4, kind: 'photo-catalog-archive',
			id: root.id, title: root.name, catalog: root, packs, ...companions, developPresetPack });
		return { document, text: serializePhotoCatalogArchiveV4(document), schemaVersion: 4, beforeFinish: verifySource };
	}, options, maximumPhotoCatalogStreamingOutputBytesV3());
}
