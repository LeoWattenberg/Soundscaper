/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { normalizePhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDevelopPresetRowV2 } from '../../src/lightscaper/storage/photo-develop-preset-row-v2.ts';
import { createImageDevelopPresetV2 } from '../../src/common/editor/imaging/image-develop-preset-v2.ts';
import { copyImageDevelopSettingsV2 } from '../../src/common/editor/imaging/image-develop-settings-v2.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

export const LUT_BODY = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
const sha256 = createHash('sha256').update(LUT_BODY).digest('hex');
export const LUT_REFERENCE = Object.freeze({ storageKey: `lut-sha256:${sha256}`, sha256, byteLength: LUT_BODY.length, size: 2,
	domainMin: Object.freeze([0, 0, 0] as const), domainMax: Object.freeze([1, 1, 1] as const) });
export function lutArchiveFixture() {
	const record = photoArchiveFixture(), version = record.photo.versions[0]!;
	const develop = { ...version.develop, processVersion: 2, effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT_REFERENCE } }] };
	const photo = normalizePhotoDocumentV2({ ...record.photo, schemaVersion: 2, versions: [{ ...version, develop }] });
	const preset = createImageDevelopPresetV2({ schemaVersion: 2, id: 'preset', name: 'LUT', settings: copyImageDevelopSettingsV2({
		schemaVersion: 2, develop, selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
	const row = normalizePhotoDevelopPresetRowV2({ schemaVersion: 2, kind: 'photo-develop-presets', catalogId: photo.catalogId, revision: 29, presets: [preset] }, photo.catalogId);
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId,
		name: 'LUT catalog', revision: 7, photoCount: 1, folders: [], keywords: [], collections: [] });
	return { root, record: { photo, original: record.original }, row };
}

/** Small test archives only; this materialized fixture is never a library iterator. */
export async function rewriteLutArchiveFixture(blob: Blob, edit: (files: Map<string, Uint8Array>) => void): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const writer = new ZipWriter(new BlobWriter(), { level: 0, zip64: true, useWebWorkers: false });
	try {
		const files = new Map<string, Uint8Array>();
		for (const entry of await reader.getEntries()) {
			if (entry.directory || !entry.getData) throw new Error('The fixture requires readable files.');
			files.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
		}
		edit(files);
		for (const [name, bytes] of files) await writer.add(name, new Uint8ArrayReader(bytes));
		return await writer.close();
	} finally { await reader.close(); }
}
