/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { serializeScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { PHOTO_STACK_PACK_ASSET_KIND, PHOTO_STACK_PACK_ENCODING } from '../../common/editor/scape-photo-stack-pack.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { array, field, id, integer, record, unique } from '../catalog/value-validation.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS, normalizePhotoCatalogArchiveV1, assertPhotoCatalogPackManifestV1,
	type PhotoCatalogArchiveDocumentV1 } from './catalog-archive-contract.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { PHOTO_STACK_PACK_LIMITS_V1 } from './stack-pack.ts';

export interface PhotoCatalogArchiveStackPackV2 { readonly id: string; readonly entry: string; readonly stackCount: number }
export interface PhotoCatalogArchiveDocumentV2 extends Omit<PhotoCatalogArchiveDocumentV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
	readonly stackCount: number;
	readonly stackPacks: readonly PhotoCatalogArchiveStackPackV2[];
}

export function normalizePhotoCatalogArchiveV2(value: unknown): PhotoCatalogArchiveDocumentV2 {
	const input = record(value, 'photo catalog archive2', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title', 'catalog', 'packs', 'stackCount', 'stackPacks']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported photo catalog archive schema version.');
	const photos = normalizePhotoCatalogArchiveV1({ schemaFamily: field(input, 'schemaFamily'), schemaVersion: 1,
		kind: field(input, 'kind'), id: field(input, 'id'), title: field(input, 'title'), catalog: field(input, 'catalog'), packs: field(input, 'packs') });
	const stackCount = integer(field(input, 'stackCount'), 0, Math.floor(photos.catalog.photoCount / 2), 'archive stack count');
	const stackPacks = array(field(input, 'stackPacks'), 'archive stack packs', 0, LIMITS.maximumPacks - photos.packs.length).map(value => {
		const pack = record(value, 'archive stack pack', ['id', 'entry', 'stackCount']), entry = field(pack, 'entry');
		if (typeof entry !== 'string' || !/^assets\/stack-pack-[0-9]{6}\.bin$/u.test(entry)) throw new TypeError('Stack pack entry is invalid.');
		return Object.freeze({ id: id(field(pack, 'id'), 'stack pack ID'), entry,
			stackCount: integer(field(pack, 'stackCount'), 1, PHOTO_STACK_PACK_LIMITS_V1.maximumRecords, 'stack pack count') });
	});
	unique([...photos.packs, ...stackPacks].map(pack => pack.id), 'archive asset pack IDs');
	unique([...photos.packs, ...stackPacks].map(pack => pack.entry), 'archive asset pack entries');
	if (stackPacks.reduce((sum, pack) => sum + pack.stackCount, 0) !== stackCount) throw new RangeError('Archive stack pack counts differ from its stack count.');
	return Object.freeze({ ...photos, schemaVersion: 2, stackCount, stackPacks: Object.freeze(stackPacks) });
}

export function serializePhotoCatalogArchiveV2(value: unknown): string {
	const text = serializeScapeProjectDocument(normalizePhotoCatalogArchiveV2(value), { currentProjectSchemaFamily: 'lightscaper' });
	if (new TextEncoder().encode(text).byteLength > LIMITS.maximumDocumentBytes) throw new RangeError('Photo archive document exceeds its byte limit.');
	return text;
}

export function assertPhotoCatalogPackManifestV2(document: PhotoCatalogArchiveDocumentV2, manifest: ScapeManifest): void {
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== 2) throw new TypeError('Archive manifest schema differs from its document.');
	if (manifest.assets.length !== document.packs.length + document.stackPacks.length) throw new RangeError('Archive manifest has a different asset pack count.');
	const photoIds = new Set(document.packs.map(pack => pack.id));
	assertPhotoCatalogPackManifestV1({ ...document, schemaVersion: 1 }, { ...manifest, assets: manifest.assets.filter(asset => photoIds.has(asset.sourceId)) });
	const assets = new Map(manifest.assets.map(asset => [asset.sourceId, asset]));
	for (const pack of document.stackPacks) {
		const asset = assets.get(pack.id);
		if (!asset || asset.entry !== pack.entry || asset.kind !== PHOTO_STACK_PACK_ASSET_KIND || asset.encoding !== PHOTO_STACK_PACK_ENCODING
			|| asset.size > PHOTO_STACK_PACK_LIMITS_V1.maximumPackBytes) throw new TypeError('Archive stack pack descriptor differs from its manifest.');
	}
}

export function admitPhotoArchiveStackV2(stack: PhotoStackV1, catalogId: string, identities: PhotoCatalogArchiveIdentityLedger): void {
	if (stack.catalogId !== catalogId) throw new RangeError('Photo stack belongs to another archive catalog.');
	identities.admitStack(stack.id, stack.photoIds);
}
