/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { serializeScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ENCODING } from '../../common/editor/scape-photo-smart-collection-pack.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from '../catalog/photo-smart-collection-v1.ts';
import { array, field, id, integer, record, unique } from '../catalog/value-validation.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV2, assertPhotoCatalogPackManifestV2, type PhotoCatalogArchiveDocumentV2 } from './catalog-archive-contract-v2.ts';
import { PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 } from './smart-collection-pack-v1.ts';

export interface PhotoCatalogArchiveSavedCollectionPackV3 { readonly id: string; readonly entry: string; readonly collectionCount: number }
export interface PhotoCatalogArchiveDocumentV3 extends Omit<PhotoCatalogArchiveDocumentV2, 'schemaVersion'> {
	readonly schemaVersion: 3;
	/** Physical absence is distinct from retained empty authority after the last deletion. */
	readonly savedCollectionState: Readonly<PhotoSmartCollectionsStateV1> | null;
	readonly savedCollectionPacks: readonly PhotoCatalogArchiveSavedCollectionPackV3[];
}

export function normalizePhotoCatalogArchiveV3(value: unknown): PhotoCatalogArchiveDocumentV3 {
	const input = record(value, 'photo catalog archive3', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title', 'catalog',
		'packs', 'stackCount', 'stackPacks', 'savedCollectionState', 'savedCollectionPacks']);
	if (field(input, 'schemaVersion') !== 3) throw new RangeError('Unsupported photo catalog archive schema version.');
	const photos = normalizePhotoCatalogArchiveV2({ schemaFamily: field(input, 'schemaFamily'), schemaVersion: 2,
		kind: field(input, 'kind'), id: field(input, 'id'), title: field(input, 'title'), catalog: field(input, 'catalog'),
		packs: field(input, 'packs'), stackCount: field(input, 'stackCount'), stackPacks: field(input, 'stackPacks') });
	const rawState = field(input, 'savedCollectionState');
	const savedCollectionState = rawState === null ? null : normalizePhotoSmartCollectionsStateV1(rawState);
	if (savedCollectionState !== null && savedCollectionState.catalogId !== photos.catalog.id) {
		throw new RangeError('Saved collection state belongs to a different archive catalog.');
	}
	const collectionCount = savedCollectionState?.collectionCount ?? 0;
	if (photos.catalog.collections.length + collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) {
		throw new RangeError('Combined archive collection count exceeds its 10000 collection budget.');
	}
	const savedCollectionPacks = array(field(input, 'savedCollectionPacks'), 'archive saved collection packs', 0,
		LIMITS.maximumPacks - photos.packs.length - photos.stackPacks.length).map(value => {
		const pack = record(value, 'archive saved collection pack', ['id', 'entry', 'collectionCount']), entry = field(pack, 'entry');
		if (typeof entry !== 'string' || !/^assets\/saved-collection-pack-[0-9]{6}\.bin$/u.test(entry)) {
			throw new TypeError('Saved collection pack entry is invalid.');
		}
		return Object.freeze({ id: id(field(pack, 'id'), 'saved collection pack ID'), entry,
			collectionCount: integer(field(pack, 'collectionCount'), 1, PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumRecords, 'saved collection pack count') });
	});
	const packs = [...photos.packs, ...photos.stackPacks, ...savedCollectionPacks];
	unique(packs.map(pack => pack.id), 'archive asset pack IDs');
	unique(packs.map(pack => pack.entry), 'archive asset pack entries');
	if (savedCollectionPacks.reduce((sum, pack) => sum + pack.collectionCount, 0) !== collectionCount) {
		throw new RangeError('Archive saved collection pack counts differ from its physical state count.');
	}
	return Object.freeze({ ...photos, schemaVersion: 3, savedCollectionState, savedCollectionPacks: Object.freeze(savedCollectionPacks) });
}

export function serializePhotoCatalogArchiveV3(value: unknown): string {
	const text = serializeScapeProjectDocument(normalizePhotoCatalogArchiveV3(value), { currentProjectSchemaFamily: 'lightscaper' });
	if (new TextEncoder().encode(text).byteLength > LIMITS.maximumDocumentBytes) throw new RangeError('Photo archive document exceeds its byte limit.');
	return text;
}

export function assertPhotoCatalogPackManifestV3(document: PhotoCatalogArchiveDocumentV3, manifest: ScapeManifest): void {
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== 3) throw new TypeError('Archive manifest schema differs from its document.');
	if (manifest.assets.length !== document.packs.length + document.stackPacks.length + document.savedCollectionPacks.length) {
		throw new RangeError('Archive manifest has a different asset pack count.');
	}
	const savedIds = new Set(document.savedCollectionPacks.map(pack => pack.id));
	assertPhotoCatalogPackManifestV2({ ...document, schemaVersion: 2 }, { ...manifest, project: { ...manifest.project, schemaVersion: 2 },
		assets: manifest.assets.filter(asset => !savedIds.has(asset.sourceId)) });
	const assets = new Map(manifest.assets.map(asset => [asset.sourceId, asset]));
	for (const pack of document.savedCollectionPacks) {
		const asset = assets.get(pack.id);
		if (!asset || asset.entry !== pack.entry || asset.kind !== PHOTO_SMART_COLLECTION_PACK_ASSET_KIND
			|| asset.encoding !== PHOTO_SMART_COLLECTION_PACK_ENCODING || !Number.isSafeInteger(asset.size)
			|| asset.size < 1 || asset.size > PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumPackBytes) {
			throw new TypeError('Archive saved collection pack descriptor differs from its manifest.');
		}
	}
}
