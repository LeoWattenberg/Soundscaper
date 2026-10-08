/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, ZipReader } from '@zip.js/zip.js/index-native.js';
import { digestScapeBytes } from '../../src/common/editor/scape-byte-stream.ts';
import type { ScapeManifest } from '../../src/common/editor/scape-archive-envelope.ts';
import type { ScapeArchiveReaderFactory } from '../../src/common/editor/scape-archive-reader.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ENCODING } from '../../src/common/editor/scape-photo-smart-collection-pack.ts';
import { exportPhotoCatalogArchiveV2 } from '../../src/lightscaper/archive/catalog-archive-export-v2.ts';
import type { PhotoCatalogArchiveStageV3 } from '../../src/lightscaper/archive/catalog-archive-import-v3.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from '../../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import type { PhotoCatalogRootV1 } from '../../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { editStackArchiveDocument, rewriteStackArchive, stackArchiveDestination, stackArchiveRecord, stackArchiveRoot } from './lightscaper-stack-archive-fixture.ts';

export function savedArchiveRootV3(photoCount = 2): PhotoCatalogRootV1 {
	return normalizePhotoCatalogRootV1({ ...stackArchiveRoot(photoCount), revision: 23,
		folders: [{ id: 'folder', name: 'Photos', parentId: null }], keywords: [{ id: 'keyword', name: 'Camera', parentId: null }],
		collections: [{ id: 'root-collection', name: 'Manual selection', kind: 'manual' }] });
}
export function savedArchiveDefinitionV3(id = 'saved-1', predicate: unknown = null): PhotoSmartCollectionV1 {
	return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog-1', id,
		revision: 17, name: 'Stored selection 界', query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Camera',
			filter: { kind: 'collection', id: 'root-collection' }, sort: { field: 'capture-time', direction: 'descending' }, predicate } });
}
export function savedArchiveStateV3(collectionCount: number, revision = 31): PhotoSmartCollectionsStateV1 {
	return normalizePhotoSmartCollectionsStateV1({ schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog-1', revision, collectionCount });
}
/** Deliberately raw framing allows authenticated semantic corruption without changing production codecs. */
export function savedArchiveFrameV3(records: readonly unknown[]): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder(), parts: Uint8Array<ArrayBuffer>[] = [encoder.encode('LSSMART1')];
	for (const record of records) {
		const bytes = encoder.encode(JSON.stringify(record)), header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, bytes.byteLength, true); parts.push(header, bytes);
	}
	const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0)); let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; } return bytes;
}
export async function savedArchiveFixtureV3(groups: readonly (readonly unknown[])[] = [[savedArchiveDefinitionV3()]],
	state: PhotoSmartCollectionsStateV1 | null = savedArchiveStateV3(groups.reduce((count, group) => count + group.length, 0)),
	root = savedArchiveRootV3()): Promise<Blob> {
	const photos = Array.from({ length: root.photoCount }, (_, index) => {
		const source = photoArchiveFixture(index + 1); return { ...source, photo: normalizePhotoDocumentV1({ ...source.photo, revision: 13 + index }) };
	});
	const exported = await exportPhotoCatalogArchiveV2(root, photos, root.photoCount >= 2 ? [stackArchiveRecord()] : []);
	if (!exported.blob) throw new Error('Fixture requires a bounded Blob archive.');
	return rewriteStackArchive(exported.blob, entries => {
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as ScapeManifest;
		const savedCollectionPacks = groups.map((group, index) => {
			const suffix = String(index + 1).padStart(6, '0'), entry = `assets/saved-collection-pack-${suffix}.bin`, id = `saved-pack-${suffix}`;
			const bytes = savedArchiveFrameV3(group); entries.set(entry, bytes);
			manifest.assets.push({ sourceId: id, entry, kind: PHOTO_SMART_COLLECTION_PACK_ASSET_KIND,
				encoding: PHOTO_SMART_COLLECTION_PACK_ENCODING, size: bytes.byteLength, sha256: digestScapeBytes(bytes) });
			return { id, entry, collectionCount: group.length };
		});
		entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
		editStackArchiveDocument(entries, document => { document.schemaVersion = 3; document.savedCollectionState = state; document.savedCollectionPacks = savedCollectionPacks; });
	});
}
export function savedArchiveDestinationV3() {
	const target = stackArchiveDestination(), saved = new Map<string, PhotoSmartCollectionV1>();
	const stage: PhotoCatalogArchiveStageV3 = { ...target.stage,
		async writeSavedCollection(definition) { saved.set(definition.id, definition); target.events.push(`saved:${definition.id}`); },
		async rollback() { saved.clear(); await target.stage.rollback(); },
	};
	return { ...target, saved, stage };
}
export function savedArchiveReaderV3(close: () => Promise<void>, afterExtract?: (name: string) => Promise<void>): ScapeArchiveReaderFactory {
	return blob => {
		const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
		return { async *getEntriesGenerator() { for (const entry of await reader.getEntries()) {
			if (entry.directory) continue;
			yield { filename: entry.filename, directory: false, encrypted: entry.encrypted, compressionMethod: entry.compressionMethod,
				compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize,
				async getData(writable, options) {
					if (options?.checkOverlappingEntryOnly) return;
					const result = await entry.getData(writable, { signal: options?.signal }); await afterExtract?.(entry.filename); return result;
				} };
		} return true; }, async close() { await reader.close(); await close(); } };
	};
}
export function savedArchiveDeferredV3() {
	let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve };
}
