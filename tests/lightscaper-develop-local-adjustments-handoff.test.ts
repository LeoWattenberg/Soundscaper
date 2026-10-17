/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import { withPhotoFramescaperHandoffReadV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-read-v1.ts';
import { inspectPhotoFramescaperHandoffSourcesV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-inspect-v1.ts';
import { createPhotoFramescaperHandoffPhotoV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-photo-v1.ts';
import type { PhotoLibraryImageHandoffPortV1 } from '../src/common/editor/photo-library-image-handoff-port-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const TIME = '2026-10-11T08:00:00.000Z';

for (const gradient of [false, true]) test(`Light ${gradient ? 'gradient' : 'legacy shape'} local recipe survives actual editable archive and fresh receive`, async () => {
	const base = photoArchiveFixture(1, PNG), version = base.photo.versions[0]!;
	const node = gradient
		? { id: 'node', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
		: { id: 'node', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 };
	const photo = normalizePhotoDocumentV1OrV2({ ...base.photo, versions: [{ ...version, develop: { ...version.develop,
		effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })],
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'node' }],
		maskBindings: [{ effectId: 'tone', maskId: 'mask' }] } }] });
	const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(_request, consume, options) {
		return await consume({ schemaVersion: 1, signal: options?.signal ?? new AbortController().signal,
			factsJson: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding)), originalBlob: base.original,
			original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: PNG.length,
				mimeType: 'image/png', width: 1, height: 1, hasAlpha: false }, lutReferences: [],
			withLutBytes: async () => { throw new Error('No LUT belongs to this recipe'); } });
	} };
	let index = 0;
	const result = await exportPhotoFramescaperHandoffArchiveV1({ capture, binding }, { createId: () => `gradient-handoff-${String(++index)}`,
		now: () => TIME, openImage: async request => {
			assert.deepEqual(request.bytes, PNG);
			return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'gradient-fixture' },
				decodeFrame: async () => ({ rgba: Uint8Array.of(23, 71, 149, 255), durationMicroseconds: null }), close() {} };
		} });
	const choices = await inspectPhotoFramescaperHandoffSourcesV1({ archive: result.blob });
	assert.equal(choices.unsupportedImageCount, 0); assert.equal(choices.sources.length, 1);
	await withPhotoFramescaperHandoffReadV1({ archive: result.blob, sourceId: choices.sources[0]!.sourceId }, async view => {
		assert.deepEqual(view.source.develop, photo.versions[0]!.develop);
		assert.deepEqual(new Uint8Array(await view.originalBlob.arrayBuffer()), PNG);
		const received = createPhotoFramescaperHandoffPhotoV1({ source: view.source, createdAt: TIME,
			catalog: { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'destination', name: 'Destination',
				revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] },
			ownership: { photoId: 'received', originalId: 'received-original', storageKey: 'received-body', masterVersionId: 'received-master' },
			metadata: photo.metadata, extractedMetadata: null });
		assert.deepEqual(received.versions[0]!.develop, photo.versions[0]!.develop);
		assert.equal(received.original.contentSha256, photo.original.contentSha256);
	});
});
