/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { field, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1OrV2, type PhotoDevelopPresetRowV2 } from './photo-develop-preset-row-v2.ts';
import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from './photo-develop-preset-row-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentForProfileV1 } from './internal/photo-develop-preset-row-kernel-v1.ts';
import type { PhotoDevelopPresetRowV3 } from './photo-develop-preset-row-v3.ts';
import { photoDevelopPresetsKeyV1, type PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';
import { assertPhotoCatalogRestoreProfileV1, type PhotoCatalogRestoreProfileV1 } from '../catalog/internal/photo-catalog-restore-records-kernel-v1.ts';

export interface PhotoMediaRestorePresetHeaderForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> {
	readonly rowSchemaVersion: Profile extends 'legacy2' ? 1 | 2 : Profile extends 'current3' ? 1 | 2 | 3 : 1 | 2 | 3 | 4;
	readonly revision: number; readonly presetCount: number;
}
export type PhotoMediaRestorePresetBindingForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> = PhotoMediaRestorePresetHeaderForProfileV1<Profile> & Readonly<{ sha256: string }>;
export type PhotoMediaRestorePresetHeaderV2 = PhotoMediaRestorePresetHeaderForProfileV1<'legacy2'>;
export type PhotoMediaRestorePresetBindingV2 = PhotoMediaRestorePresetBindingForProfileV1<'legacy2'>;
type PresetRow<Profile extends PhotoCatalogRestoreProfileV1> = Profile extends 'legacy2' ? PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 : Profile extends 'current3' ? PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 | PhotoDevelopPresetRowV3 : PhotoDevelopPresetRowCurrentV1;

export function admitPhotoMediaRestorePresetHeaderV2(value: unknown): Readonly<PhotoMediaRestorePresetHeaderV2> | null {
	return admitPhotoMediaRestorePresetHeaderForProfileV1('legacy2', value);
}
export function admitPhotoMediaRestorePresetsV2(value: unknown, catalogId: string, expected: PhotoMediaRestorePresetHeaderV2 | null): PresetRow<'legacy2'> {
	return admitPhotoMediaRestorePresetsForProfileV1('legacy2', value, catalogId, expected);
}
export function bindPhotoMediaRestorePresetsV2(row: PresetRow<'legacy2'>): Readonly<PhotoMediaRestorePresetBindingV2> {
	return bindPhotoMediaRestorePresetsForProfileV1('legacy2', row);
}
export function readPhotoMediaRestorePresetsV2(settings: IDBObjectStore, catalogId: string, expected: PhotoMediaRestorePresetBindingV2 | null): Promise<PresetRow<'legacy2'> | null> {
	return readPhotoMediaRestorePresetsForProfileV1('legacy2', settings, catalogId, expected);
}
export function assertPhotoMediaRestorePresetsV2(settings: IDBObjectStore, catalogId: string, expected: PhotoMediaRestorePresetBindingV2 | null): Promise<void> {
	return assertPhotoMediaRestorePresetsForProfileV1('legacy2', settings, catalogId, expected);
}

export function admitPhotoMediaRestorePresetHeaderForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, value: unknown): Readonly<PhotoMediaRestorePresetHeaderForProfileV1<Profile>> | null {
	assertPhotoCatalogRestoreProfileV1(profile);
	if (value === null) return null;
	const input = record(value, 'restore Develop preset header2', ['rowSchemaVersion', 'revision', 'presetCount']);
	const version = field(input, 'rowSchemaVersion');
	if (version !== 1 && version !== 2 && !(profile !== 'legacy2' && version === 3) && !(profile === 'current4' && version === 4)) throw new TypeError('Restore preset row version is unsupported.');
	return Object.freeze({ rowSchemaVersion: version, revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'restore preset revision'),
		presetCount: integer(field(input, 'presetCount'), 0, 16, 'restore preset count') }) as Readonly<PhotoMediaRestorePresetHeaderForProfileV1<Profile>>;
}
export function admitPhotoMediaRestorePresetsForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, value: unknown, catalogId: string,
	expected: PhotoMediaRestorePresetHeaderForProfileV1<Profile> | null): PresetRow<Profile> {
	assertPhotoCatalogRestoreProfileV1(profile);
	if (expected === null) throw new Error('Restore Develop presets were declared absent.');
	const row = (profile === 'legacy2' ? normalizePhotoDevelopPresetRowV1OrV2(value, catalogId) : profile === 'current3'
		? normalizePhotoDevelopPresetRowCurrentForProfileV1('current3', value, catalogId) : normalizePhotoDevelopPresetRowCurrentV1(value, catalogId)) as PresetRow<Profile>;
	if (row.schemaVersion !== expected.rowSchemaVersion || row.revision !== expected.revision || row.presets.length !== expected.presetCount) throw new Error('Restore preset row differs from its declared version/header.');
	return row;
}
/** Only bounded scalars and the complete canonical digest survive delivery. */
export function bindPhotoMediaRestorePresetsForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, row: PresetRow<Profile>): Readonly<PhotoMediaRestorePresetBindingForProfileV1<Profile>> {
	assertPhotoCatalogRestoreProfileV1(profile);
	const bytes = new TextEncoder().encode(JSON.stringify(row));
	try { return Object.freeze({ rowSchemaVersion: row.schemaVersion, revision: row.revision, presetCount: row.presets.length,
		sha256: bytesToHex(sha256(bytes)) }) as Readonly<PhotoMediaRestorePresetBindingForProfileV1<Profile>>; }
	finally { bytes.fill(0); }
}
/** Exact physical absence or a complete authenticated delivered row; one point read. */
export async function readPhotoMediaRestorePresetsForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, settings: IDBObjectStore, catalogId: string,
	expected: PhotoMediaRestorePresetBindingForProfileV1<Profile> | null): Promise<PresetRow<Profile> | null> {
	assertPhotoCatalogRestoreProfileV1(profile);
	const key = photoDevelopPresetsKeyV1(catalogId), raw: unknown = await request(settings.get(key));
	if (expected === null) { if (raw !== undefined) throw new Error('Restore preset state differs from declared absence.'); return null; }
	if (raw === undefined) throw new Error('Restore preset row was not delivered.');
	const wrapper = record(raw, 'restore preset settings wrapper', ['key', 'value']);
	if (field(wrapper, 'key') !== key) throw new Error('Restore preset settings key differs.');
	const row = admitPhotoMediaRestorePresetsForProfileV1(profile, field(wrapper, 'value'), catalogId, expected);
	if (bindPhotoMediaRestorePresetsForProfileV1(profile, row).sha256 !== expected.sha256) throw new Error('Restore preset row changed after delivery.');
	return row;
}
export async function assertPhotoMediaRestorePresetsForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, settings: IDBObjectStore, catalogId: string,
	expected: PhotoMediaRestorePresetBindingForProfileV1<Profile> | null): Promise<void> { await readPhotoMediaRestorePresetsForProfileV1(profile, settings, catalogId, expected); }
