/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { exclusiveMotionOpfs } from './helpers/motionscaper-exclusive-opfs.ts';
import { motionscaperMixedPreviewFixture } from './helpers/motionscaper-mixed-preview-fixture.ts';
import { exportFramescaperSuccessorPortableArchive } from '../src/framescaper/editor-project-successor-portable-export.ts';
import { importFramescaperSuccessorPortableArchive } from '../src/framescaper/editor-project-successor-portable-import.ts';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { OpfsSyncWorkerRuntime } from '../src/common/editor/storage/opfs-sync-worker-runtime.ts';

const snapshot = (id: string, path = 'image') => ({ id, type: 'snapshot', operationId: 'media-asset-chunk-read', path });
const read = (id: string, path = 'image') => ({ id, type: 'read', operationId: 'media-asset-chunk-read', path, offset: 1, length: 2 });
async function runtimeFixture() {
	const opfs = exclusiveMotionOpfs({ image: Uint8Array.of(1, 2, 3), other: Uint8Array.of(4, 5, 6) });
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	await runtime.handle({ id: 'init', type: 'initialize', directory: opfs.directory });
	return { opfs, runtime };
}

test('Motion mixed-image owner closes and reopens with exact concurrent retained OPFS reads', async () => {
	const { project, image } = motionscaperMixedPreviewFixture(); const opfs = exclusiveMotionOpfs();
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const options = { line: 'successor', storeOptions: { indexedDB, opfsRoot: opfs.root, preferOpfs: true } };
	const archive = await exportFramescaperSuccessorPortableArchive(project, {
		getMediaAssetMetadata: async () => ({ sourceId: image.source.storageKey, size: image.bytes.length, sha256: image.source.contentSha256 }),
		loadMediaAsset: async () => new Blob([image.bytes.slice()]),
		async *readSourceChunks() { yield []; throw new Error('No ordinary PCM exists'); },
	}, { readAsset: async () => null });
	assert.ok(archive.blob); const restore = opfs.installWorker();
	let environment: Awaited<ReturnType<typeof createFramescaperSuccessorEnvironment>> | null = null;
	try {
		environment = await createFramescaperSuccessorEnvironment(options);
		await importFramescaperSuccessorPortableArchive(archive.blob, environment.store, { indexedDB, line: 'successor' });
		const originalMetadata = await environment.store.getMediaAssetMetadata(image.source.storageKey);
		assert.equal(originalMetadata?.storage, 'opfs');
		await environment.close();
		environment = await createFramescaperSuccessorEnvironment(options);
		assert.deepEqual(await environment.controllerStore.loadProject(project.id), project);
		assert.equal(typeof originalMetadata?.path, 'string'); const path = originalMetadata!.path as string;
		const hold = opfs.pause(path); const first = environment.store.loadMediaAsset(image.source.storageKey); await hold.entered;
		const submitted = opfs.nextSnapshot(path), second = environment.store.loadMediaAsset(image.source.storageKey);
		const bodies = Promise.allSettled([first, second]); await submitted; hold.release();
		for (const result of await bodies) { assert.equal(result.status, 'fulfilled'); }
		for (const result of await bodies) { if (result.status !== 'fulfilled') continue; const body = result.value; assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), image.bytes); }
		assert.deepEqual(await environment.store.getMediaAssetMetadata(image.source.storageKey), originalMetadata);
		assert.ok(opfs.workers.length >= 2); assert.deepEqual(new Set(opfs.workers.map(worker => worker.name)), new Set(['framescaper-editor-v2-media-opfs-storage']));
		assert.equal(opfs.held.size, 0); assert.equal(opfs.acquired.length, opfs.closed.length);
	} finally { await environment?.close(); restore(); }
	assert.ok(opfs.workers.every(worker => worker.terminated));
});

test('Motion same-path snapshots and ranges share acquisition order while other paths stay concurrent', async () => {
	const { opfs, runtime } = await runtimeFixture(); const hold = opfs.pause('image');
	const first = runtime.handle(snapshot('first')); await hold.entered;
	const second = runtime.handle(read('second')); const settledSecond = Promise.allSettled([second]);
	try {
		const other = await runtime.handle(snapshot('other', 'other'));
		assert.deepEqual(new Uint8Array(await (other.file as Blob).arrayBuffer()), Uint8Array.of(4, 5, 6));
		assert.deepEqual(opfs.acquired, ['image', 'other']);
	} finally { hold.release(); }
	assert.equal((await first).size, 3);
	const result = (await settledSecond)[0]!; assert.equal(result.status, 'fulfilled');
	if (result.status === 'fulfilled') assert.deepEqual(new Uint8Array(result.value.bytes as ArrayBuffer), Uint8Array.of(2, 3));
	assert.deepEqual(opfs.acquired, ['image', 'other', 'image']); assert.equal(opfs.held.size, 0);
});

test('Motion queued OPFS cancellation never acquires a handle or poisons the next read', async () => {
	const { opfs, runtime } = await runtimeFixture(); const hold = opfs.pause('image');
	const first = runtime.handle(snapshot('first')); await hold.entered;
	const cancelled = runtime.handle(read('cancelled')); const result = Promise.allSettled([cancelled]);
	await runtime.handle({ id: 'cancelled', type: 'cancel' }); hold.release(); await first;
	const failure = (await result)[0]!; assert.equal(failure.status, 'rejected');
	if (failure.status === 'rejected') assert.equal((failure.reason as Error).name, 'AbortError');
	assert.deepEqual(opfs.acquired, ['image']);
	assert.equal((await runtime.handle(snapshot('later'))).size, 3); assert.equal(opfs.held.size, 0);
});

test('Motion failed same-path read closes its handle and preserves its error without poisoning followers', async () => {
	const { opfs, runtime } = await runtimeFixture(); const failure = new Error('native size read failed');
	opfs.failures.set('image', failure); const first = runtime.handle(snapshot('first'));
	const second = runtime.handle(snapshot('second')); const results = await Promise.allSettled([first, second]);
	assert.equal(results[0]!.status, 'rejected'); if (results[0]!.status === 'rejected') assert.equal(results[0]!.reason, failure);
	assert.equal(results[1]!.status, 'fulfilled'); assert.equal(opfs.held.size, 0); assert.equal(opfs.closed.length, 2);
	await assert.rejects(runtime.handle(snapshot('missing', 'missing')), { name: 'NotFoundError' });
	assert.equal((await runtime.handle(read('after-missing'))).size, 3);
});
