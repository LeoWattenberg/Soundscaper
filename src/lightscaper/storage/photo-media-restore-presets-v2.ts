/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { field, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1OrV2, type PhotoDevelopPresetRowV2 } from './photo-develop-preset-row-v2.ts';
import { photoDevelopPresetsKeyV1, type PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';

export interface PhotoMediaRestorePresetHeaderV2 { readonly rowSchemaVersion: 1 | 2; readonly revision: number; readonly presetCount: number }
export interface PhotoMediaRestorePresetBindingV2 extends PhotoMediaRestorePresetHeaderV2 { readonly sha256: string }
type PresetRow = PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2;

export function admitPhotoMediaRestorePresetHeaderV2(value: unknown): Readonly<PhotoMediaRestorePresetHeaderV2> | null {
	if (value === null) return null;
	const input = record(value, 'restore Develop preset header2', ['rowSchemaVersion', 'revision', 'presetCount']);
	const version = field(input, 'rowSchemaVersion');
	if (version !== 1 && version !== 2) throw new TypeError('Restore preset row version is unsupported.');
	return Object.freeze({ rowSchemaVersion: version, revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'restore preset revision'),
		presetCount: integer(field(input, 'presetCount'), 0, 16, 'restore preset count') });
}

export function admitPhotoMediaRestorePresetsV2(value: unknown, catalogId: string, expected: PhotoMediaRestorePresetHeaderV2 | null): PresetRow {
	if (expected === null) throw new Error('Restore Develop presets were declared absent.');
	const row = normalizePhotoDevelopPresetRowV1OrV2(value, catalogId);
	if (row.schemaVersion !== expected.rowSchemaVersion || row.revision !== expected.revision || row.presets.length !== expected.presetCount) {
		throw new Error('Restore preset row differs from its declared version/header.');
	}
	return row;
}
/** Only bounded scalars and the complete canonical digest survive delivery. */
export function bindPhotoMediaRestorePresetsV2(row: PresetRow): Readonly<PhotoMediaRestorePresetBindingV2> {
	const bytes = new TextEncoder().encode(JSON.stringify(row));
	try { return Object.freeze({ rowSchemaVersion: row.schemaVersion, revision: row.revision, presetCount: row.presets.length, sha256: bytesToHex(sha256(bytes)) }); }
	finally { bytes.fill(0); }
}

/** Exact physical absence or a complete authenticated delivered row; one point read, no inventory. */
export async function readPhotoMediaRestorePresetsV2(settings: IDBObjectStore, catalogId: string,
	expected: PhotoMediaRestorePresetBindingV2 | null): Promise<PresetRow | null> {
	const key = photoDevelopPresetsKeyV1(catalogId), raw: unknown = await request(settings.get(key));
	if (expected === null) { if (raw !== undefined) throw new Error('Restore preset state differs from declared absence.'); return null; }
	if (raw === undefined) throw new Error('Restore preset row was not delivered.');
	const wrapper = record(raw, 'restore preset settings wrapper', ['key', 'value']);
	if (field(wrapper, 'key') !== key) throw new Error('Restore preset settings key differs.');
	const row = admitPhotoMediaRestorePresetsV2(field(wrapper, 'value'), catalogId, expected);
	if (bindPhotoMediaRestorePresetsV2(row).sha256 !== expected.sha256) throw new Error('Restore preset row changed after delivery.');
	return row;
}
export async function assertPhotoMediaRestorePresetsV2(settings: IDBObjectStore, catalogId: string,
	expected: PhotoMediaRestorePresetBindingV2 | null): Promise<void> { await readPhotoMediaRestorePresetsV2(settings, catalogId, expected); }
