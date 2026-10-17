/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { CATALOG_ORIGINAL_ROOT_STORE_NAME } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const assetId = 'retained-original';
const bytes = Uint8Array.of(1, 3, 5, 7);
const sha256 = createHash('sha256').update(bytes).digest('hex');
type WriteKind = 'blob' | 'stream';
type RootKind = 'committed' | 'provisional';

for (const preferOpfs of [false, true]) {
	for (const writeKind of ['blob', 'stream'] as const) {
		for (const rootKind of ['committed', 'provisional'] as const) {
			test(`${writeKind} publication refuses a missing ${rootKind} rooted key (${preferOpfs ? 'OPFS' : 'IndexedDB'})`, async (context) => {
				const fixture = await createFixture(context, preferOpfs);
				await createRetainedOriginal(fixture, rootKind);
				const roots = fixture.roots();
				const files = new Map(fixture.opfs.files);
				await removeMediaRow(fixture);
				fixture.transactions.length = 0;

				// Even identical bytes cannot recreate the private identity pinned by these roots.
				await assert.rejects(publish(fixture.media, writeKind), /retained by a catalog original root/u);

				assert.equal(await fixture.media.getAssetMetadata(assetId), null);
				assert.deepEqual(fixture.roots(), roots);
				assert.deepEqual(fixture.opfs.files, files);
				assertNoStaging(fixture);
				assertRootedPublicationTransaction(fixture, writeKind);
			});
		}
	}
}

test('streamed publication rechecks roots acquired after writer admission and body staging', async (context) => {
	const fixture = await createFixture(context, false);
	const writer = await fixture.media.beginAssetWrite(assetId, {}, { expectedBytes: bytes.length, expectedSha256: sha256 });
	await writer.write(bytes);
	assert.equal(fixture.indexedDB.recordCount(fixture.databaseName, 'mediaAssetChunks'), 1);
	await createRetainedOriginal(fixture, 'provisional', fixture.createMedia());
	const roots = fixture.roots();
	await removeMediaRow(fixture);
	fixture.transactions.length = 0;

	await assert.rejects(writer.commit(), /retained by a catalog original root/u);
	await writer.abort();

	assert.equal(await fixture.media.getAssetMetadata(assetId), null);
	assert.deepEqual(fixture.roots(), roots);
	assertNoStaging(fixture);
	assertRootedPublicationTransaction(fixture, 'stream');
});

test('Blob publication rechecks roots acquired while its OPFS body close is pending', async (context) => {
	const fixture = await createFixture(context, true);
	const heldClose = fixture.opfs.holdNextClose();
	const pending = fixture.media.writeAsset(assetId, new Blob([bytes]));
	try {
		await heldClose.entered;
		await createRetainedOriginal(fixture, 'committed', fixture.createMedia());
		const roots = fixture.roots();
		const originalPaths = [...fixture.opfs.files.keys()].slice(1);
		assert.equal(originalPaths.length, 1);
		await removeMediaRow(fixture);
		fixture.transactions.length = 0;
		heldClose.release();

		await assert.rejects(pending, /retained by a catalog original root/u);

		assert.equal(await fixture.media.getAssetMetadata(assetId), null);
		assert.deepEqual(fixture.roots(), roots);
		assert.deepEqual([...fixture.opfs.files.keys()], originalPaths);
		assertNoStaging(fixture);
		assertRootedPublicationTransaction(fixture, 'blob');
	} finally {
		heldClose.release();
		await pending.catch(() => undefined);
	}
});

for (const preferOpfs of [false, true]) {
	for (const writeKind of ['blob', 'stream'] as const) {
		test(`${writeKind} publication still creates unrooted immutable media (${preferOpfs ? 'OPFS' : 'IndexedDB'})`, async (context) => {
			const fixture = await createFixture(context, preferOpfs);
			await publish(fixture.media, writeKind);
			const row = fixture.indexedDB.records(fixture.databaseName, 'mediaAssets')[0] as Record<string, unknown>;
			assert.equal(row.sha256, sha256);
			assert.equal(row.size, bytes.length);
			assert.equal(typeof row.mediaContentToken, 'string');
			assert.deepEqual(fixture.roots(), []);
			const body = await fixture.media.loadAsset(assetId);
			assert.ok(body);
			assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
			assert.equal((await fixture.media.activeAssetStaging()).paths.size, 0);
			assert.equal((await fixture.media.activeAssetStaging()).mediaChunkTokens.size, 0);
			assertRootedPublicationTransaction(fixture, writeKind);
		});
	}
}

for (const writeKind of ['blob', 'stream'] as const) {
	test(`${writeKind} publication permits an unrelated key while another original is rooted`, async (context) => {
		const fixture = await createFixture(context, false);
		await createRetainedOriginal(fixture, 'committed');
		const roots = fixture.roots();
		const original = await fixture.media.getAssetMetadata(assetId);
		await publish(fixture.media, writeKind, 'unrelated-original');
		assert.equal((await fixture.media.getAssetMetadata('unrelated-original'))?.sha256, sha256);
		assert.deepEqual(await fixture.media.getAssetMetadata(assetId), original);
		assert.deepEqual(fixture.roots(), roots);
	});
}

test('existing rows remain immutable when rooted, including a competing staged writer', async (context) => {
	const fixture = await createFixture(context, false);
	const writer = await fixture.media.beginAssetWrite(assetId, {}, { expectedBytes: bytes.length, expectedSha256: sha256 });
	await writer.write(bytes);
	await createRetainedOriginal(fixture, 'committed', fixture.createMedia());
	const rows = fixture.indexedDB.records(fixture.databaseName, 'mediaAssets');
	const roots = fixture.roots();

	await assert.rejects(fixture.media.writeAsset(assetId, new Blob([bytes])), /Immutable media asset/u);
	await assert.rejects(fixture.media.beginAssetWrite(assetId, {}, { expectedBytes: bytes.length, expectedSha256: sha256 }), /Immutable media asset/u);
	await assert.rejects(writer.commit(), /Immutable media asset/u);
	assert.deepEqual(fixture.indexedDB.records(fixture.databaseName, 'mediaAssets'), rows);
	assert.deepEqual(fixture.roots(), roots);
	assertNoStaging(fixture);
});

async function createFixture(context: TestContext, preferOpfs: boolean) {
	const databaseName = `rooted-key-recreation-${crypto.randomUUID()}`;
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const transactions: Array<Readonly<{ stores: readonly string[]; mode: IDBTransactionMode | undefined }>> = [];
	const beginTransaction = database.transaction.bind(database);
	database.transaction = (stores, mode, options) => {
		transactions.push({ stores: typeof stores === 'string' ? [stores] : [...stores], mode });
		return beginTransaction(stores, mode, options);
	};
	const opfs = fakeOpfs();
	const resources: Array<Readonly<{ media: MediaRepository; storage: OpfsRepository }>> = [];
	const createMedia = () => {
		const storage = new OpfsRepository({
			preferOpfs,
			opfsRoot: opfs.directory as unknown as FileSystemDirectoryHandle,
			syncWorkerClient: null,
		});
		const media = new MediaRepository({ memory: getMemoryDatabase(databaseName), database: async () => database }, storage);
		resources.push({ media, storage });
		return media;
	};
	context.after(async () => {
		for (const { media, storage } of resources) {
			await media.beginAssetMaintenance({ permanent: true }).abortActive();
			await storage.close();
		}
		database.close();
	});
	return {
		media: createMedia(), createMedia, database, databaseName, indexedDB, opfs, transactions,
		roots: () => indexedDB.records(databaseName, CATALOG_ORIGINAL_ROOT_STORE_NAME),
	};
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createRetainedOriginal(fixture: Fixture, kind: RootKind, media = fixture.media): Promise<void> {
	const metadata = await media.writeAsset(assetId, new Blob([bytes]));
	const reference = { photoId: 'photo', assetId, sourceId: 'camera-source', sha256, size: bytes.length };
	assert.equal(metadata.sha256, sha256);
	if (kind === 'committed') await media.catalogOriginals.retain('catalog', [reference]);
	else await media.catalogOriginals.stage('catalog', 'import', [reference]);
	const [root] = fixture.roots() as Array<Record<string, unknown>>;
	const [row] = fixture.indexedDB.records(fixture.databaseName, 'mediaAssets') as Array<Record<string, unknown>>;
	assert.equal(root?.mediaContentToken, row?.mediaContentToken);
	assert.equal(typeof root?.mediaContentToken, 'string');
}

async function removeMediaRow(fixture: Fixture): Promise<void> {
	// Simulate metadata loss while retaining the real custody record and original body.
	await transact(fixture.database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => {
		await request(mediaAssets.delete(assetId));
	});
	assert.equal(await fixture.media.getAssetMetadata(assetId), null);
	assert.equal(fixture.roots().length, 1);
}

async function publish(media: MediaRepository, kind: WriteKind, id = assetId): Promise<void> {
	if (kind === 'blob') {
		await media.writeAsset(id, new Blob([bytes]));
		return;
	}
	const writer = await media.beginAssetWrite(id, {}, { expectedBytes: bytes.length, expectedSha256: sha256 });
	try {
		await writer.write(bytes);
		await writer.commit();
	} finally { await writer.abort(); }
}

function assertNoStaging(fixture: Fixture): void {
	assert.equal(fixture.indexedDB.recordCount(fixture.databaseName, 'mediaAssetChunks'), 0);
	const staging = fixture.indexedDB.records(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME) as Array<Record<string, unknown>>;
	assert.equal(staging.filter(({ kind }) => kind === 'lease').length, 0);
}

function assertRootedPublicationTransaction(fixture: Fixture, kind: WriteKind): void {
	assert.ok(fixture.transactions.some(({ stores, mode }) => mode === 'readwrite'
		&& stores.includes('mediaAssets') && stores.includes(CATALOG_ORIGINAL_ROOT_STORE_NAME)
		&& (kind === 'blob' || stores.includes(MEDIA_ASSET_STAGING_STORE_NAME))));
}

function fakeOpfs() {
	const files = new Map<string, Blob>();
	let nextClose: Readonly<{ entered(): void; settled: Promise<void> }> | null = null;
	const holdNextClose = () => {
		const entered = deferred();
		const settled = deferred();
		nextClose = { entered: () => entered.resolve(), settled: settled.promise };
		return { entered: entered.promise, release: () => settled.resolve() };
	};
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() {
							const held = nextClose;
							nextClose = null;
							if (held) { held.entered(); await held.settled; }
							files.set(path, new Blob(parts));
						},
						async abort() {},
					};
				},
				async getFile() {
					const blob = files.get(path);
					if (!blob) throw new DOMException('missing', 'NotFoundError');
					return blob;
				},
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return { directory, files, holdNextClose };
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
