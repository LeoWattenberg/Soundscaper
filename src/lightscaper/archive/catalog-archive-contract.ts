/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from '../../common/editor/scape-archive-limits.ts';
import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND, PHOTO_CATALOG_PACK_ENCODING } from '../../common/editor/scape-photo-catalog-pack.ts';
import { serializeScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogIndexSourceV1 } from '../catalog/photo-catalog-index-source-v1.ts';
import { array, field, id, integer, name, oneOf, record, requireSchema, unique } from '../catalog/value-validation.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V1 } from './catalog-pack.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';

export const PHOTO_CATALOG_ARCHIVE_LIMITS_V1 = Object.freeze({
	maximumDocumentBytes: 4 * 1024 * 1024,
	maximumPacks: SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2,
	maximumIdentityBytes: 16 * 1024 * 1024,
});

export interface PhotoCatalogArchivePackV1 {
	readonly id: string;
	readonly entry: string;
	readonly photoCount: number;
}

export interface PhotoCatalogArchiveDocumentV1 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 1;
	readonly kind: 'photo-catalog-archive';
	readonly id: string;
	readonly title: string;
	readonly catalog: PhotoCatalogRootV1;
	readonly packs: readonly PhotoCatalogArchivePackV1[];
}

export function normalizePhotoCatalogArchiveV1(value: unknown): PhotoCatalogArchiveDocumentV1 {
	const input = record(value, 'photo catalog archive', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title', 'catalog', 'packs']);
	requireSchema(input);
	oneOf(field(input, 'kind'), ['photo-catalog-archive'] as const, 'photo archive kind');
	const catalog = readValidatedPhotoCatalogRootV1(field(input, 'catalog'));
	const packs = array(field(input, 'packs'), 'photo archive packs', 0, PHOTO_CATALOG_ARCHIVE_LIMITS_V1.maximumPacks).map((value) => {
		const pack = record(value, 'photo archive pack', ['id', 'entry', 'photoCount']);
		const entry = field(pack, 'entry');
		if (typeof entry !== 'string' || !/^assets\/photo-pack-[0-9]{6}\.bin$/u.test(entry)) throw new TypeError('Photo archive pack entry is invalid.');
		return Object.freeze({ id: id(field(pack, 'id'), 'photo pack ID'), entry,
			photoCount: integer(field(pack, 'photoCount'), 1, PHOTO_CATALOG_PACK_LIMITS_V1.maximumRecords, 'photo pack record count') });
	});
	unique(packs.map((pack) => pack.id), 'photo archive pack IDs');
	unique(packs.map((pack) => pack.entry), 'photo archive pack entries');
	if (field(input, 'id') !== catalog.id || field(input, 'title') !== catalog.name) throw new RangeError('Photo archive identity differs from its catalog.');
	if (packs.reduce((sum, pack) => sum + pack.photoCount, 0) !== catalog.photoCount) throw new RangeError('Photo archive pack counts differ from its catalog count.');
	return Object.freeze({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog-archive',
		id: catalog.id, title: name(field(input, 'title'), 'photo archive title'), catalog, packs: Object.freeze(packs) });
}

export function serializePhotoCatalogArchiveV1(value: unknown): string {
	const text = serializeScapeProjectDocument(normalizePhotoCatalogArchiveV1(value), { currentProjectSchemaFamily: 'lightscaper' });
	if (new TextEncoder().encode(text).byteLength > PHOTO_CATALOG_ARCHIVE_LIMITS_V1.maximumDocumentBytes) throw new RangeError('Photo archive document exceeds its byte limit.');
	return text;
}

export function assertPhotoCatalogPackManifestV1(document: PhotoCatalogArchiveDocumentV1, manifest: ScapeManifest): void {
	if (manifest.assets.length !== document.packs.length) throw new RangeError('Photo archive manifest has a different pack count.');
	const assets = new Map(manifest.assets.map((asset) => [asset.sourceId, asset]));
	for (const pack of document.packs) {
		const asset = assets.get(pack.id);
		if (!asset || asset.entry !== pack.entry || asset.kind !== PHOTO_CATALOG_PACK_ASSET_KIND
			|| asset.encoding !== PHOTO_CATALOG_PACK_ENCODING || asset.size > PHOTO_CATALOG_PACK_LIMITS_V1.maximumPackBytes) {
			throw new TypeError('Photo archive pack descriptor differs from its manifest.');
		}
	}
}

/** Retains bounded IDs and root-definition indexes, never photo aggregates. */
export class PhotoCatalogArchiveIdentityGuard {
	readonly #identity: PhotoCatalogArchiveIdentityLedger;
	readonly #folders: ReadonlySet<string>;
	readonly #keywords: ReadonlySet<string>;
	readonly #collections: ReadonlySet<string>;

	constructor(readonly catalog: PhotoCatalogRootV1, identity = new PhotoCatalogArchiveIdentityLedger()) {
		this.#identity = identity;
		this.#folders = new Set(catalog.folders.map((value) => value.id));
		this.#keywords = new Set(catalog.keywords.map((value) => value.id));
		this.#collections = new Set(catalog.collections.filter((value) => value.kind === 'manual').map((value) => value.id));
	}

	get count(): number { return this.#identity.photoCount; }

	admit(photo: PhotoCatalogIndexSourceV1): void {
		if (photo.catalogId !== this.catalog.id) throw new RangeError('Photo belongs to a different archive catalog.');
		if (this.#identity.hasPhoto(photo.id)) throw new RangeError('Photo archive contains a duplicate photo identity.');
		if (photo.folderId !== null && !this.#folders.has(photo.folderId)
			|| photo.keywordIds.some((key) => !this.#keywords.has(key))
			|| photo.collectionIds.some((key) => !this.#collections.has(key))) throw new ReferenceError('Photo archive references a missing catalog definition.');
		if (this.#identity.photoCount >= this.catalog.photoCount) throw new RangeError('Photo archive exceeds its catalog count.');
		this.#identity.admitPhoto(photo.id);
	}
}
