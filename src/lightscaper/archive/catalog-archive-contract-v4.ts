/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { serializeScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, PHOTO_DEVELOP_PRESET_PACK_ENCODING } from '../../common/editor/scape-photo-develop-preset-pack.ts';
import { field, id, integer, record, unique } from '../catalog/value-validation.ts';
import { PHOTO_DEVELOP_PRESETS_LIMITS_V1 } from '../storage/photo-develop-presets-v1.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV3, assertPhotoCatalogPackManifestV3, type PhotoCatalogArchiveDocumentV3 } from './catalog-archive-contract-v3.ts';

export interface PhotoCatalogArchiveDevelopPresetPackV4 {
	readonly id: string;
	readonly entry: 'assets/develop-presets-v1.bin';
	readonly revision: number;
	readonly presetCount: number;
}
export interface PhotoCatalogArchiveDocumentV4 extends Omit<PhotoCatalogArchiveDocumentV3, 'schemaVersion'> {
	readonly schemaVersion: 4;
	/** Absence stays absent; deleting the last preset retains an empty positive-revision pack. */
	readonly developPresetPack: Readonly<PhotoCatalogArchiveDevelopPresetPackV4> | null;
}

export function normalizePhotoCatalogArchiveV4(value: unknown): PhotoCatalogArchiveDocumentV4 {
	const input = record(value, 'photo catalog archive4', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title', 'catalog',
		'packs', 'stackCount', 'stackPacks', 'savedCollectionState', 'savedCollectionPacks', 'developPresetPack']);
	if (field(input, 'schemaVersion') !== 4) throw new RangeError('Unsupported photo catalog archive schema version.');
	const previous = normalizePhotoCatalogArchiveV3({ schemaFamily: field(input, 'schemaFamily'), schemaVersion: 3,
		kind: field(input, 'kind'), id: field(input, 'id'), title: field(input, 'title'), catalog: field(input, 'catalog'),
		packs: field(input, 'packs'), stackCount: field(input, 'stackCount'), stackPacks: field(input, 'stackPacks'),
		savedCollectionState: field(input, 'savedCollectionState'), savedCollectionPacks: field(input, 'savedCollectionPacks') });
	const raw = field(input, 'developPresetPack'); let developPresetPack: PhotoCatalogArchiveDevelopPresetPackV4 | null = null;
	if (raw !== null) {
		const pack = record(raw, 'archive Develop preset pack', ['id', 'entry', 'revision', 'presetCount']);
		if (field(pack, 'entry') !== 'assets/develop-presets-v1.bin') throw new TypeError('Develop preset pack entry is invalid.');
		developPresetPack = Object.freeze({ id: id(field(pack, 'id'), 'Develop preset pack ID'), entry: 'assets/develop-presets-v1.bin',
			revision: integer(field(pack, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset pack revision'),
			presetCount: integer(field(pack, 'presetCount'), 0, PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumPresets, 'Develop preset pack count') });
	}
	const packs = [...previous.packs, ...previous.stackPacks, ...previous.savedCollectionPacks, ...(developPresetPack ? [developPresetPack] : [])];
	if (packs.length > LIMITS.maximumPacks) throw new RangeError('Archive packs exceed the shared entry count.');
	unique(packs.map(pack => pack.id), 'archive asset pack IDs'); unique(packs.map(pack => pack.entry), 'archive asset pack entries');
	return Object.freeze({ ...previous, schemaVersion: 4, developPresetPack });
}

export function serializePhotoCatalogArchiveV4(value: unknown): string {
	const text = serializeScapeProjectDocument(normalizePhotoCatalogArchiveV4(value), { currentProjectSchemaFamily: 'lightscaper' });
	if (new TextEncoder().encode(text).byteLength > LIMITS.maximumDocumentBytes) throw new RangeError('Photo archive document exceeds its byte limit.');
	return text;
}

export function assertPhotoCatalogPackManifestV4(document: PhotoCatalogArchiveDocumentV4, manifest: ScapeManifest): void {
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== 4) throw new TypeError('Archive manifest schema differs from its document.');
	const pack = document.developPresetPack;
	if (manifest.assets.length !== document.packs.length + document.stackPacks.length + document.savedCollectionPacks.length + (pack ? 1 : 0)) {
		throw new RangeError('Archive manifest has a different asset pack count.');
	}
	assertPhotoCatalogPackManifestV3({ ...document, schemaVersion: 3 }, { ...manifest, project: { ...manifest.project, schemaVersion: 3 },
		assets: pack ? manifest.assets.filter(asset => asset.sourceId !== pack.id) : manifest.assets });
	if (pack) {
		const asset = manifest.assets.find(asset => asset.sourceId === pack.id);
		if (!asset || asset.entry !== pack.entry || asset.kind !== PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND || asset.encoding !== PHOTO_DEVELOP_PRESET_PACK_ENCODING
			|| !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumRowBytes) {
			throw new TypeError('Archive Develop preset pack descriptor differs from its manifest.');
		}
	}
}
