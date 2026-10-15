/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { exportPhotoFramescaperCollectionHandoffArchiveCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV2 } from '../src/common/editor/photo-library-collection-handoff-port-v2.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../src/common/editor/timeline-image-pack-source-current-v1.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

test('Light Current collection archive decodes real RAW and raster Originals in captured order without collapsing aliases', async () => {
	const f = await createRawFrameFixtureCurrentV1(), bodies = [f.original, PNG, f.original], events: string[] = [];
	const photos = bodies.map((bytes, index) => {
		const base = photoArchiveFixture(index, bytes).photo, raw = index !== 1;
		const photo = normalizePhotoDocumentCurrentV1({ ...base, schemaVersion: 3,
			original: { ...base.original, name: raw ? `Ordered ${index}.dng` : 'Ordered raster.png', mimeType: raw ? 'image/x-adobe-dng' : 'image/png', width: raw ? 32 : 1, height: raw ? 32 : 1 } });
		return { binding: { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision },
			factsJson: serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo,
				{ catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision })),
			original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: bytes.byteLength,
				mimeType: photo.original.mimeType, width: photo.original.width, height: photo.original.height, hasAlpha: false } };
	});
	const signal = new AbortController().signal, binding = { catalogId: 'catalog-1', collectionId: 'ordered', scope: 'catalog' as const, expectedCatalogRevision: 7 };
	const capture: PhotoLibraryCollectionHandoffPortV2 = { async withCapture(request, consume) {
		assert.equal(this, capture); assert.deepEqual(request, binding);
		return consume({ schemaVersion: 2, signal, collection: { catalogId: binding.catalogId, id: binding.collectionId, scope: binding.scope,
			name: 'RAW and raster order', catalogRevision: 7, indexRevision: 7, definitionRevision: null, definitionJson: '{}' },
			photos, lutReferences: [], maskRasterReferences: [],
			async withOriginal(photoId, borrow) { const index = photos.findIndex(photo => photo.binding.photoId === photoId); assert.ok(index >= 0); events.push(photoId);
				return borrow(new Blob([bodies[index]!], { type: photos[index]!.original.mimeType })); },
			withLutBytes: async () => assert.fail('No resource body is declared.'), withMaskRasterBytes: async () => assert.fail('No brush body is declared.') });
	} };
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try { await f.withDefaultTransport(async () => {
		let ids = 0;
		const result = await exportPhotoFramescaperCollectionHandoffArchiveCurrentV1({ capture, binding }, { createId: () => `raw-collection-${++ids}`,
			now: () => '2026-10-15T00:00:00.000Z', openImage: async request => {
				assert.deepEqual(request.bytes, PNG); events.push('raster-open');
				return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'literal-node-raster-transport' },
					decodeFrame: async () => ({ rgba: Uint8Array.of(0, 0, 0, 255), durationMicroseconds: null }), close() { events.push('raster-close'); } };
			} });
		assert.equal(result.photoCount, 3);
		const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(result.blob, store), project = cloneFramescaperProject(PROFILE, imported.project);
		const sources = project.sources.filter(source => source.kind === 'image').map(normalizeFramescaperImageSourceCurrentV1);
		assert.deepEqual(sources.map(source => source.schemaVersion), [4, 3, 4]);
		assert.deepEqual(sources.map(source => source.original.fileName), photos.map(photo => photo.original.exactName));
		assert.deepEqual(project.clips.map(clip => { assert.equal(clip.kind, 'image'); if (clip.kind !== 'image') assert.fail('Image placement required.');
			return [clip.sequenceStartFrame, clip.sequenceFrameCount]; }), [[0, 150], [150, 150], [300, 150]]);
		assert.equal(new Set(sources.map(source => source.storageKey)).size, 3); assert.equal(sources[0]!.original.sha256, sources[2]!.original.sha256);
		for (const [index, source] of sources.entries()) {
			const bytes = new Uint8Array(await (await store.loadMediaAsset(source.storageKey))!.arrayBuffer());
			const reader = await openFramescaperImageFramePackV1({ source: framescaperImagePackSourceCurrentV1(source), read: (offset, length) => bytes.slice(offset, offset + length) });
			assert.deepEqual(await reader.readOriginal(), bodies[index]);
		}
		assert.deepEqual(events, [photos[0]!.binding.photoId, photos[1]!.binding.photoId, 'raster-open', 'raster-close', photos[2]!.binding.photoId]);
		assert.equal(f.workers.active(), 0);
	}); } finally { await store.close(); await f.close(); }
});
