/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeAssetDescriptor, ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { serializeScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND } from '../../common/editor/scape-photo-catalog-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2 } from '../../common/editor/scape-photo-catalog-pack-v2.ts';
import { PHOTO_CATALOG_PACK_ENCODING_V4, PHOTO_DEVELOP_PRESET_PACK_ENCODING_V3 } from '../../common/editor/scape-photo-catalog-pack-v4.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ENCODING_V4 } from '../../common/editor/scape-photo-develop-preset-pack-v4.ts';
import { PHOTO_CATALOG_PACK_ENCODING_V3 } from '../../common/editor/scape-photo-catalog-pack-v3.ts';
import { PHOTO_MASK_RASTER_ASSET_KIND_V1, PHOTO_MASK_RASTER_ENCODING_V1 } from '../../common/editor/scape-photo-mask-raster-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizePhotoMaskRasterArchiveReferenceV1 } from './mask-raster-archive-source-v1.ts';
import { PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1 } from '../catalog/photo-cube-lut-closure-v1.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../../common/editor/scape-photo-cube-lut.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from '../../common/editor/scape-photo-develop-preset-pack.ts';
import { PHOTO_STACK_PACK_ASSET_KIND, PHOTO_STACK_PACK_ENCODING } from '../../common/editor/scape-photo-stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ENCODING } from '../../common/editor/scape-photo-smart-collection-pack.ts';
import { normalizeCubeLutProfileEffectV1 } from '../../common/editor/video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { array, field, id, integer, record, unique } from '../catalog/value-validation.ts';
import { PHOTO_DEVELOP_PRESETS_LIMITS_V1 } from '../storage/photo-develop-presets-v1.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS } from './catalog-archive-contract.ts';
import { normalizePhotoCatalogArchiveV3, type PhotoCatalogArchiveDocumentV3 } from './catalog-archive-contract-v3.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V2 } from './catalog-pack-v2.ts';
import { PHOTO_STACK_PACK_LIMITS_V1 } from './stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 } from './smart-collection-pack-v1.ts';

export interface PhotoCatalogArchiveDevelopPresetPackForVersion<Version extends 6 | 7 | 8> {
	readonly id: string; readonly entry: Version extends 8 ? 'assets/develop-presets-v4.bin' : Version extends 7 ? 'assets/develop-presets-v3.bin' : 'assets/develop-presets-v2.bin';
	readonly rowSchemaVersion: Version extends 8 ? 1 | 2 | 3 | 4 : Version extends 7 ? 1 | 2 | 3 : 1 | 2; readonly revision: number; readonly presetCount: number;
}
export interface PhotoCatalogArchiveMaskRasterResource {
	readonly id: string; readonly entry: string; readonly reference: Readonly<BrushMaskResourceReferenceV1>;
}
export interface PhotoCatalogArchiveLutResource {
	readonly id: string; readonly entry: string; readonly reference: Readonly<VideoCubeLutReferenceV1>;
}
/** Roots, stacks, saved collections and original framing retain their owners.
 * Photo pack3 and authenticated mask assets extend the retained resource closure.
 * These scalar declarations are not reachable-inventory or raw-body proof. */
export interface PhotoCatalogArchiveDocumentForVersion<Version extends 6 | 7 | 8> extends Omit<PhotoCatalogArchiveDocumentV3, 'schemaVersion'> {
	readonly schemaVersion: Version;
	readonly developPresetPack: Readonly<PhotoCatalogArchiveDevelopPresetPackForVersion<Version>> | null;
	readonly lutResources: readonly Readonly<PhotoCatalogArchiveLutResource>[];
	readonly maskRasters: readonly Readonly<PhotoCatalogArchiveMaskRasterResource>[];
}

export function normalizePhotoCatalogArchiveForVersion<Version extends 6 | 7 | 8>(version: Version, value: unknown): PhotoCatalogArchiveDocumentForVersion<Version> {
	assertVersion(version);
	const input = record(value, 'photo catalog archive6', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title', 'catalog',
		'packs', 'stackCount', 'stackPacks', 'savedCollectionState', 'savedCollectionPacks', 'developPresetPack', 'lutResources', 'maskRasters']);
	if (field(input, 'schemaVersion') !== version) throw new RangeError('Unsupported photo catalog archive schema version.');
	const previous = normalizePhotoCatalogArchiveV3({ schemaFamily: field(input, 'schemaFamily'), schemaVersion: 3,
		kind: field(input, 'kind'), id: field(input, 'id'), title: field(input, 'title'), catalog: field(input, 'catalog'),
		packs: field(input, 'packs'), stackCount: field(input, 'stackCount'), stackPacks: field(input, 'stackPacks'),
		savedCollectionState: field(input, 'savedCollectionState'), savedCollectionPacks: field(input, 'savedCollectionPacks') });
	const raw = field(input, 'developPresetPack'); let developPresetPack: PhotoCatalogArchiveDevelopPresetPackForVersion<Version> | null = null;
	if (raw !== null) {
		const pack = record(raw, 'archive Develop preset pack2', ['id', 'entry', 'rowSchemaVersion', 'revision', 'presetCount']);
		const rowVersion = field(pack, 'rowSchemaVersion'), entry = version === 8 ? 'assets/develop-presets-v4.bin' : version === 7 ? 'assets/develop-presets-v3.bin' : 'assets/develop-presets-v2.bin';
		if (field(pack, 'entry') !== entry || (rowVersion !== 1 && rowVersion !== 2 && !(version >= 7 && rowVersion === 3) && !(version === 8 && rowVersion === 4))) throw new TypeError('Develop preset pack entry or row version is invalid.');
		developPresetPack = Object.freeze({ id: id(field(pack, 'id'), 'Develop preset pack ID'), entry: entry as PhotoCatalogArchiveDevelopPresetPackForVersion<Version>['entry'],
			rowSchemaVersion: rowVersion as PhotoCatalogArchiveDevelopPresetPackForVersion<Version>['rowSchemaVersion'], revision: integer(field(pack, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'Develop preset pack revision'),
			presetCount: integer(field(pack, 'presetCount'), 0, PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumPresets, 'Develop preset pack count') });
	}
	const packs = [...previous.packs, ...previous.stackPacks, ...previous.savedCollectionPacks, ...(developPresetPack ? [developPresetPack] : [])];
	if (packs.length > LIMITS.maximumPacks) throw new RangeError('Archive packs exceed the shared entry count.');
	const lutResources = array(field(input, 'lutResources'), 'archive LUT resources', 0, LIMITS.maximumPacks - packs.length).map(value => {
		const row = record(value, 'archive LUT resource', ['id', 'entry', 'reference']);
		const reference = normalizeCubeLutProfileEffectV1({ id: 'archive-resource', type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: field(row, 'reference') } }).params.lut;
		if (reference === null) throw new TypeError('Archive LUT resources require exact nonnull references.');
		const entry = `assets/luts/${reference.sha256}.cube`;
		if (field(row, 'id') !== reference.storageKey || field(row, 'entry') !== entry) throw new TypeError('Archive LUT namespace differs from its pinned reference.');
		return Object.freeze({ id: reference.storageKey, entry, reference });
	});
	const maskRasters = array(field(input, 'maskRasters'), 'archive mask resources', 0, LIMITS.maximumPacks - packs.length - lutResources.length).map(value => {
		const row = record(value, 'archive mask resource', ['id', 'entry', 'reference']);
		const reference = normalizePhotoMaskRasterArchiveReferenceV1(field(row, 'reference'));
		const entry = `assets/masks/${reference.sha256}.scmask`;
		if (field(row, 'id') !== reference.storageKey || field(row, 'entry') !== entry) throw new TypeError('Archive mask namespace differs from its pinned reference.');
		return Object.freeze({ id: reference.storageKey, entry, reference });
	});
	const encoder = new TextEncoder();
	const identityBytes = lutResources.reduce((bytes, row) => bytes + 64 + encoder.encode(JSON.stringify(row.reference)).byteLength + 8, 0)
		+ maskRasters.reduce((bytes, row) => bytes + row.id.length + encoder.encode(JSON.stringify(row.reference)).byteLength + 8, 0);
	if (identityBytes > PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumIdentityBytes) throw new RangeError('Combined archive resources exceed their identity byte limit.');
	const combined = [...packs, ...lutResources, ...maskRasters];
	unique(combined.map(row => row.id), 'archive asset IDs'); unique(combined.map(row => row.entry), 'archive asset entries');
	lutResources.sort((left, right) => left.reference.sha256 < right.reference.sha256 ? -1 : left.reference.sha256 > right.reference.sha256 ? 1 : 0);
	maskRasters.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
	return Object.freeze({ ...previous, schemaVersion: version, developPresetPack, lutResources: Object.freeze(lutResources), maskRasters: Object.freeze(maskRasters) });
}

export function serializePhotoCatalogArchiveForVersion<Version extends 6 | 7 | 8>(version: Version, value: unknown): string {
	const text = serializeScapeProjectDocument(normalizePhotoCatalogArchiveForVersion(version, value), { currentProjectSchemaFamily: 'lightscaper' });
	if (text.length > LIMITS.maximumDocumentBytes || new TextEncoder().encode(text).byteLength > LIMITS.maximumDocumentBytes) throw new RangeError('Photo archive document exceeds its byte limit.');
	return text;
}

export function assertPhotoCatalogPackManifestForVersion<Version extends 6 | 7 | 8>(version: Version, document: PhotoCatalogArchiveDocumentForVersion<Version>, manifest: ScapeManifest): void {
	assertVersion(version);
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== version) throw new TypeError('Archive manifest schema differs from its document.');
	const preset = document.developPresetPack, count = document.packs.length + document.stackPacks.length
		+ document.savedCollectionPacks.length + (preset ? 1 : 0) + document.lutResources.length + document.maskRasters.length;
	if (manifest.assets.length !== count) throw new RangeError('Archive manifest has a different asset count.');
	const assets = new Map(manifest.assets.map(asset => [asset.sourceId, asset]));
	if (assets.size !== count || new Set(manifest.assets.map(asset => asset.entry)).size !== count) throw new TypeError('Archive manifest repeats an asset identity.');
	for (const pack of document.packs) assertPack(assets.get(pack.id), pack.entry, PHOTO_CATALOG_PACK_ASSET_KIND, version >= 7 ? PHOTO_CATALOG_PACK_ENCODING_V4 : PHOTO_CATALOG_PACK_ENCODING_V3, PHOTO_CATALOG_PACK_LIMITS_V2.maximumPackBytes);
	for (const pack of document.stackPacks) assertPack(assets.get(pack.id), pack.entry, PHOTO_STACK_PACK_ASSET_KIND, PHOTO_STACK_PACK_ENCODING, PHOTO_STACK_PACK_LIMITS_V1.maximumPackBytes);
	for (const pack of document.savedCollectionPacks) assertPack(assets.get(pack.id), pack.entry, PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ENCODING, PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumPackBytes);
	if (preset) assertPack(assets.get(preset.id), preset.entry, PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND, version === 8 ? PHOTO_DEVELOP_PRESET_PACK_ENCODING_V4 : version === 7 ? PHOTO_DEVELOP_PRESET_PACK_ENCODING_V3 : PHOTO_DEVELOP_PRESET_PACK_ENCODING_V2, PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumRowBytes);
	for (const row of document.lutResources) {
		const asset = assets.get(row.id); assertPack(asset, row.entry, PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING, row.reference.byteLength);
		if (asset!.size !== row.reference.byteLength || asset!.sha256 !== row.reference.sha256) throw new TypeError('Archive LUT descriptor differs from its pinned body identity.');
	}
	for (const row of document.maskRasters) {
		const asset = assets.get(row.id); assertPack(asset, row.entry, PHOTO_MASK_RASTER_ASSET_KIND_V1, PHOTO_MASK_RASTER_ENCODING_V1, row.reference.byteLength);
		if (asset!.size !== row.reference.byteLength || asset!.sha256 !== row.reference.sha256) throw new TypeError('Archive mask descriptor differs from its pinned body identity.');
	}
}
function assertPack(asset: ScapeAssetDescriptor | undefined, entry: string, kind: string, encoding: string, maximum: number): void {
	if (!asset || asset.entry !== entry || asset.kind !== kind || asset.encoding !== encoding
		|| !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maximum) throw new TypeError('Archive asset descriptor differs from its declared profile.');
}

function assertVersion(value: unknown): void {
	if (value !== 6 && value !== 7 && value !== 8) throw new RangeError('Unsupported fixed catalog archive version.');
}
