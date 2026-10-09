/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../../common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 } from '../../common/editor/scape-photo-catalog-pack-v2.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../../common/editor/scape-photo-cube-lut.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../storage/photo-develop-preset-row-v2.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV5, serializePhotoCatalogArchiveV5,
	type PhotoCatalogArchiveDocumentV5, type PhotoCatalogArchiveDevelopPresetPackV5 } from './catalog-archive-contract-v5.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { createPhotoCatalogCompanionWriter } from './catalog-archive-companion-packs.ts';
import { writePhotoCatalogArchiveV5, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-v5.ts';
import type { PhotoCatalogArchiveExportOptionsV3 } from './catalog-archive-export-v3.ts';
import type { PhotoCatalogPackInputV2 } from './catalog-pack-v2.ts';
import { encodePhotoDevelopPresetPackV2 } from './develop-preset-pack-v2.ts';
import { borrowPhotoCubeLutArchiveSourceV1, type PhotoCubeLutArchiveSourceV1 } from './cube-lut-archive-source-v1.ts';

export type PhotoCatalogArchiveExportResultV5 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV5>;

/** Complete admitted Photo/preset closure, then serial exact body publication.
 * Originals, stacks and saved collections retain their existing authorities.
 * Scalar identities survive enumeration; no full photo list or body cache. */
export async function exportPhotoCatalogArchiveV5(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>, rowValue: unknown,
	lutSource: PhotoCubeLutArchiveSourceV1 | undefined, options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveExportResultV5> {
	const root = readValidatedPhotoCatalogRootV1(rootValue), signal = options.signal;
	const state = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	const row = rowValue === null ? null : normalizePhotoDevelopPresetRowV1OrV2(rowValue, root.id);
	const readBody = borrowPhotoCubeLutArchiveSourceV1(lutSource, signal);
	const verifySource = options.verifySource;
	if (verifySource !== undefined && typeof verifySource !== 'function') throw new TypeError('A source verification callback is required.');
	const verify = () => verifySource === undefined ? Promise.resolve() : Reflect.apply(verifySource, options, []);
	const reachability = createPhotoCubeLutReachabilityV1();
	for (const preset of row?.presets ?? []) reachability.addPreset(preset);
	const identity = new PhotoCatalogArchiveIdentityLedger();
	const writeCompanions = createPhotoCatalogCompanionWriter(root, stacks, state, definitions, identity, signal);
	async function* records() { for await (const value of photos) {
		const input = record(value, 'photo archive input', ['photo', 'original']);
		const photo = normalizePhotoDocumentV1OrV2(field(input, 'photo', 'photo archive input'));
		const original = canonicalMediaContentBlob(field(input, 'original', 'photo archive input'));
		reachability.addPhoto(photo); yield { photo, original };
	} }
	return writePhotoCatalogArchiveV5(root, records(), new PhotoCatalogArchiveIdentityGuard(root, identity), async (packs, writer) => {
		const companions = await writeCompanions(writer);
		let developPresetPack: PhotoCatalogArchiveDevelopPresetPackV5 | null = null;
		if (row) {
			developPresetPack = Object.freeze({ id: 'develop-presets', entry: 'assets/develop-presets-v2.bin', rowSchemaVersion: row.schemaVersion,
				revision: row.revision, presetCount: row.presets.length });
			await writer.addPack({ sourceId: developPresetPack.id, entry: developPresetPack.entry, kind: PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND,
				encoding: PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 }, encodePhotoDevelopPresetPackV2(row, root.id, { signal }));
		}
		const lutResources = reachability.finish().map(reference => Object.freeze({ id: reference.storageKey, entry: `assets/luts/${reference.sha256}.cube`, reference }));
		// Admit the complete combined entry budget before any LUT body acquisition.
		const document = normalizePhotoCatalogArchiveV5({ schemaFamily: 'lightscaper', schemaVersion: 5, kind: 'photo-catalog-archive',
			id: root.id, title: root.name, catalog: root, packs, ...companions, developPresetPack, lutResources });
		for (const resource of document.lutResources) await readBody(resource.reference, async bytes => {
			async function* chunks() { for (let offset = 0; offset < bytes.byteLength; offset += 65_536) yield bytes.subarray(offset, offset + 65_536); }
			await writer.addPack({ sourceId: resource.id, entry: resource.entry, kind: PHOTO_CUBE_LUT_ASSET_KIND, encoding: PHOTO_CUBE_LUT_ENCODING }, chunks());
		});
		return { document, text: serializePhotoCatalogArchiveV5(document), schemaVersion: 5, async beforeFinish() {
			for (const resource of document.lutResources) await readBody(resource.reference, async () => undefined);
			// Saved inventory verification is one-shot. Run its complete source fence
			// after every held resource reread and immediately before destination Close.
			await verify();
		} };
	}, options);
}
