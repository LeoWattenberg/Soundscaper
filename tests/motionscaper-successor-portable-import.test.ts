/* SPDX-License-Identifier: AGPL-3.0-only */
import { createScapeArchiveByteSource, createBlobScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { smallMotionscaperArchiveBytes } from './helpers/motionscaper-small-archive-bytes.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { normalizeFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { scapeImportCapacityRequirement } from '../src/common/editor/scape-import-capacity.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { exportFramescaperSuccessorPortableArchive } from '../src/framescaper/editor-project-successor-portable-export.ts';
import { importFramescaperSuccessorPortableArchive, loadFramescaperSuccessorPortableCustody } from '../src/framescaper/editor-project-successor-portable-import.ts';
const bytes = new Uint8Array([7, 8, 9]); const sha256 = digestScapeBytes(bytes);
async function fixture() {
	const image = createFramescaperBaselineImageFixture();
	const audio = createAudioSource({ id: 'ordinary-pcm', name: 'Unused PCM', sampleRate: 48000, channelCount: 1, frameCount: 4, chunkFrames: 4 });
	const asset = { kind: 'image' as const, id: 'unused-image', name: 'Unused original', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}` };
	const revision = createMotionscaperRevision({ ...createMotionscaperProject({ id: 'motion', title: 'Linked scene', compositionId: 'main', width: 2, height: 1, durationFrames: 3 }), assets: [asset] });
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', audioSourceId: 'linked-audio', offer: createMotionCompositionOffer('main', revision), sampleRate: 48000 });
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' }); const base = runtime.createProject({ id: 'portable-frame', title: 'Fresh edited Frame', sources: [audio, linked.source, linked.audioSource!] });
	const imageProject = runtime.applyCommand(base, { type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source });
	const project = normalizeFramescaperSuccessorProject({ ...imageProject, compositionLinks: [linked.link] });
	const { blob } = await exportFramescaperSuccessorPortableArchive(project, {
		getMediaAssetMetadata: async () => ({ sourceId: image.source.storageKey, size: image.bytes.length, sha256: image.source.contentSha256 }),
		loadMediaAsset: async () => new Blob([image.bytes.slice()]),
		async *readSourceChunks(id) { assert.equal(id, audio.id); yield [new Float32Array([0.25, 0.5, 0.75, 1])]; },
	}, { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() }) }); assert.ok(blob);
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB, preferOpfs: false } });
	return { project, linked, image, asset, audio, blob, factory, indexedDB, environment };
}

test('M10 full schema2 import publishes one owner with exact original/PCM/link closure and separate portable custody', async () => {
	const f = await fixture();
	try {
		const result = await importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: f.indexedDB, line: 'successor' });
		assert.deepEqual(result.project, f.project); assert.equal(result.publicationCommitted, true);
		const owner = await f.environment.owners.loadOwner(f.project.id); assert.deepEqual(owner?.project, f.project); assert.deepEqual(owner?.history.undoStack, []);
		assert.deepEqual(new Uint8Array(await (await f.environment.store.loadMediaAsset(f.image.source.id))!.arrayBuffer()), f.image.bytes);
		const chunks = []; for await (const chunk of f.environment.store.readSourceChunks(f.audio.id)) chunks.push(chunk.channels[0]); assert.deepEqual(chunks, [new Float32Array([0.25, 0.5, 0.75, 1])]);
		const body = await f.environment.owners.readAsset(f.asset); assert.ok(body); assert.deepEqual(new Uint8Array(await new Response(body.stream()).arrayBuffer()), bytes);
		assert.equal(await f.environment.store.getSourceMetadata(f.linked.audioSource!.storageKey), null); assert.equal(await f.environment.store.getMediaAssetMetadata(f.linked.source.storageKey), null);
		assert.equal(await f.environment.custody.load(f.project.id), null); const portable = await loadFramescaperSuccessorPortableCustody(f.project.id, { indexedDB: f.indexedDB, line: 'successor' });
		assert.equal(portable?.kind, 'framescaper-successor-portable-v1'); assert.deepEqual(portable?.project, f.project); assert.equal(portable?.archive.size, f.blob.size);
		assert.equal(await f.environment.store.loadProject(f.project.id), null); assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v1', 'projects'), 0);
		await f.environment.close(); const reopened = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: f.indexedDB, preferOpfs: false } });
		try { assert.deepEqual(await reopened.controllerStore.loadProject(f.project.id), f.project); } finally { await reopened.close(); }
	} finally { await f.environment.close(); }
});

test('M10 full import failure never publishes partial owner/link custody and preserves ordinary candidate roots for safe retry', async () => {
	const f = await fixture();
	try {
		f.factory.failNextPutForStore('owners', new Error('portable owner failed'));
		await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: f.indexedDB, line: 'successor' }), /portable owner failed/u);
		assert.equal(await f.environment.owners.loadOwner(f.project.id), null); assert.equal(await f.environment.owners.readAsset(f.asset), null);
		assert.equal(await loadFramescaperSuccessorPortableCustody(f.project.id, { indexedDB: f.indexedDB, line: 'successor' }), null);
		for (const name of ['archiveStages', 'archiveChunks', 'archiveBodies']) assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v2', name), 0);
		assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0); assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v2', 'linkStates'), 0);
		assert.ok(await f.environment.store.getMediaAssetMetadata(f.image.source.id)); assert.equal(await f.environment.store.loadProject(f.project.id), null);
		await importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: f.indexedDB, line: 'successor' });
		await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: f.indexedDB, line: 'successor' }), /already|conflict/u);
		assert.deepEqual((await f.environment.owners.loadOwner(f.project.id))?.project, f.project);
	} finally { await f.environment.close(); }
});


test('M10 portable import refuses wrong product media ownership and pre-cancelled publication', async () => {
	const f = await fixture();
	try {
		await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.controllerStore, { indexedDB: f.indexedDB, line: 'successor' }), /authentic|profile/u);
		const different = createInstrumentedIndexedDB() as unknown as IDBFactory;
		await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: different, line: 'successor' }), /same successor/u);
		await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: f.indexedDB, line: 'baseline' }), /successor/u);
		const abort = new AbortController(); abort.abort(); await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { indexedDB: f.indexedDB, line: 'successor', signal: abort.signal }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
		assert.equal(await f.environment.owners.loadOwner(f.project.id), null); assert.equal(await f.environment.store.getSourceMetadata(f.audio.id), null);
	} finally { await f.environment.close(); }
});

test('M10 portable custody admits a bounded range source without materializing the original archive', async () => {
	const f = await fixture(); const blobSource = createBlobScapeArchiveByteSource(f.blob); let largestRead = 0;
	const input = createScapeArchiveByteSource({ size: f.blob.size, maximumReadBytes: 97, read(request) { largestRead = Math.max(largestRead, request.length); return blobSource.read(request); } });
	try {
		await importFramescaperSuccessorPortableArchive(input, f.environment.store, { indexedDB: f.indexedDB, line: 'successor' });
		assert.equal(largestRead, 97); const custody = await loadFramescaperSuccessorPortableCustody(f.project.id, { indexedDB: f.indexedDB, line: 'successor' });
		assert.ok(custody); assert.ok(!(custody.archive instanceof Blob));
		assert.deepEqual(await smallMotionscaperArchiveBytes(custody.archive), new Uint8Array(await f.blob.arrayBuffer()));
	} finally { await f.environment.close(); }
});

test('M10 portable preflight counts only remaining assets after exact archive chunks already consume live quota', async () => {
	const f = await fixture();
	const remaining = await withScapeProjectInput(f.blob, undefined, async entries => {
		const { manifest } = await readScapeArchiveEnvelope(entries, {}, undefined, ['motion-linked-original', 'framescaper-image-asset']);
		return scapeImportCapacityRequirement(manifest);
	});
	try {
		const estimate = (short: boolean) => (assetBytes: number) => {
			assert.ok(f.factory.recordCount('kw-media-framescaper-editor-v2', 'archiveChunks') > 0);
			assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v2', 'archiveBodies'), 0);
			assert.equal(assetBytes, remaining.assetBytes);
			const usage = f.blob.size + 4096;
			return { usage, quota: usage + remaining.requiredFreeBytes - (short ? 1 : 0) };
		};
		await assert.rejects(importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { line: 'successor', estimateStorageForPreflight: estimate(true) }), /not enough storage/u);
		for (const store of ['archiveBodies', 'archiveChunks', 'archiveStages', 'owners']) assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v2', store), 0);
		await importFramescaperSuccessorPortableArchive(f.blob, f.environment.store, { line: 'successor', estimateStorageForPreflight: estimate(false) });
		assert.equal((await f.environment.owners.loadOwner(f.project.id))?.project.id, f.project.id);
	} finally { await f.environment.close(); }
});
