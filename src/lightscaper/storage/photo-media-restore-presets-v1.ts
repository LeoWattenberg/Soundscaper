/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { field, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1, type PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';

export interface PhotoMediaRestorePresetHeaderV1 { readonly revision: number; readonly presetCount: number }
export interface PhotoMediaRestorePresetBindingV1 extends PhotoMediaRestorePresetHeaderV1 { readonly sha256: string }

export function admitPhotoMediaRestorePresetHeaderV1(value: unknown): Readonly<PhotoMediaRestorePresetHeaderV1> | null {
	if (value === null) return null;
	const input = record(value, 'restore Develop preset header', ['revision', 'presetCount']);
	return Object.freeze({ revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'restore preset revision'),
		presetCount: integer(field(input, 'presetCount'), 0, 16, 'restore preset count') });
}

/** The caller holds its synchronous admission latch. Only one detached row survives until native completion. */
export function admitPhotoMediaRestorePresetsV1(value: unknown, catalogId: string, expected: PhotoMediaRestorePresetHeaderV1 | null): PhotoDevelopPresetRowV1 {
	if (expected === null) throw new Error('Restore Develop presets were declared absent.');
	const row = normalizePhotoDevelopPresetRowV1(value, catalogId);
	if (row.revision !== expected.revision || row.presets.length !== expected.presetCount) throw new Error('Restore preset row differs from its declared header.');
	return row;
}

/** This serial component hashes the complete canonical row; it retains no recipe or serialized body afterwards.
 * A row is <=10MiB; transient owning normalization/JSON/UTF8 copies are not a total heap bound. */
export function bindPhotoMediaRestorePresetsV1(row: PhotoDevelopPresetRowV1): Readonly<PhotoMediaRestorePresetBindingV1> {
	const bytes = new TextEncoder().encode(JSON.stringify(row));
	try { return Object.freeze({ revision: row.revision, presetCount: row.presets.length, sha256: bytesToHex(sha256(bytes)) }); }
	finally { bytes.fill(0); }
}

/** Borrowed settings transaction: exact absence or one authenticated complete delivered row, never an inventory. */
export async function assertPhotoMediaRestorePresetsV1(settings: IDBObjectStore, catalogId: string,
	expected: PhotoMediaRestorePresetBindingV1 | null): Promise<void> {
	const key = photoDevelopPresetsKeyV1(catalogId), raw: unknown = await request(settings.get(key));
	if (expected === null) { if (raw !== undefined) throw new Error('Restore preset state differs from declared absence.'); return; }
	if (raw === undefined) throw new Error('Restore preset row was not delivered.');
	const wrapper = record(raw, 'restore preset settings wrapper', ['key', 'value']);
	if (field(wrapper, 'key') !== key) throw new Error('Restore preset settings key differs.');
	const row = admitPhotoMediaRestorePresetsV1(field(wrapper, 'value'), catalogId, expected), binding = bindPhotoMediaRestorePresetsV1(row);
	if (binding.sha256 !== expected.sha256) throw new Error('Restore preset row changed after delivery.');
}
