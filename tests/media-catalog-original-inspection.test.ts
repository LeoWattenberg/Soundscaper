/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaCatalogOriginalInspectionRepositoryV1 } from '../src/common/editor/storage/media-catalog-original-inspection-repository.ts';
import { MediaAssetLifecycleCoordinator } from '../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../src/common/editor/storage/media-content-digest.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { mediaAssetChunkKey } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createRepairFixture, deferred, type RepairFixture } from './helpers/media-catalog-original-repair-fixture.ts';

function inspector(fixture: RepairFixture, lifecycle = new MediaAssetLifecycleCoordinator()) {
	return new MediaCatalogOriginalInspectionRepositoryV1(fixture.port, fixture.storage, lifecycle);
}

test('all supported retained original layouts authenticate exact bodies and expose scalar outcomes only', async t => {
	for (const layout of ['inline', 'chunks', 'opfs'] as const) await t.test(layout, async child => {
		const fixture = await createRepairFixture(child, layout);
		const roots = structuredClone(fixture.roots()), row = structuredClone(fixture.row());
		fixture.transactions.length = 0;
		const result = await inspector(fixture).inspect(fixture.binding);
		assert.deepEqual(result, { status: 'present' });
		assert.ok(Object.isFrozen(result));
		assert.deepEqual(fixture.roots(), roots);
		assert.deepEqual(fixture.row(), row);
		assert.ok(fixture.transactions.every(({ mode }) => mode === 'readonly'));
	});
});

test('missing committed and provisional media rows retain custody and distinguish media-row absence', async t => {
	for (const provisional of [false, true]) await t.test(String(provisional), async child => {
		const fixture = await createRepairFixture(child, 'inline', provisional);
		await fixture.removeRow(); const roots = structuredClone(fixture.roots());
		assert.deepEqual(await inspector(fixture).inspect(fixture.binding), { status: 'missing', reason: 'media-row' });
		assert.deepEqual(fixture.roots(), roots);
	});
});

test('missing OPFS and chunk payloads are distinct from media rows and storage errors', async t => {
	await t.test('OPFS', async child => {
		const fixture = await createRepairFixture(child, 'opfs');
		fixture.opfs.files.clear();
		assert.deepEqual(await inspector(fixture).inspect(fixture.binding), { status: 'missing', reason: 'file' });
	});
	await t.test('chunk', async child => {
		const fixture = await createRepairFixture(child, 'chunks');
		await transact(fixture.database, 'mediaAssetChunks', 'readwrite', async ({ mediaAssetChunks }) => { await request(mediaAssetChunks.clear()); });
		assert.deepEqual(await inspector(fixture).inspect(fixture.binding), { status: 'missing', reason: 'chunk' });
	});
});

test('actual body size and SHA-256 are verified rather than trusting original metadata', async t => {
	for (const [body, expected] of [[new Blob(['short']), 'size'], [new Blob([Uint8Array.of(2, 4, 6, 8)]), 'digest']] as const) {
		await t.test(expected, async child => {
			const fixture = await createRepairFixture(child, 'opfs'), stored = fixture.row();
			assert.equal(typeof stored?.path, 'string'); fixture.opfs.files.set(String(stored?.path), body);
			assert.deepEqual(await inspector(fixture).inspect(fixture.binding), { status: 'corrupt', reason: expected });
		});
	}
});

test('missing custody, mismatching logical identities and untrusted media provenance reject inspection', async t => {
	const fixture = await createRepairFixture(t), service = inspector(fixture);
	for (const patch of [{ photoId: 'unretained' }, { sourceId: 'other-original' }, { assetId: 'other-asset' },
		{ sha256: 'a'.repeat(64) }, { size: fixture.binding.size + 1 }]) {
		await assert.rejects(service.inspect({ ...fixture.binding, ...patch }));
	}
	await transact(fixture.database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => {
		await request(mediaAssets.put({ ...fixture.row(), mediaContentDigestVersion: 0 }));
	});
	await assert.rejects(service.inspect(fixture.binding));
});

test('strict inspection preserves permission failures and unsupported stored layouts', async t => {
	const fixture = await createRepairFixture(t, 'opfs'), failure = new DOMException('Permission refused', 'NotAllowedError');
	fixture.storage.inspectBinaryRecord = () => Promise.reject(failure);
	await assert.rejects(inspector(fixture).inspect(fixture.binding), error => error === failure);
	await transact(fixture.database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => {
		await request(mediaAssets.put({ ...fixture.row(), storage: 'unknown' }));
	});
	await assert.rejects(inspector(fixture).inspect(fixture.binding), TypeError);
});

test('malformed persisted chunk encoding is refused rather than called missing', async t => {
	const fixture = await createRepairFixture(t, 'chunks');
	await transact(fixture.database, 'mediaAssetChunks', 'readwrite', async ({ mediaAssetChunks }) => {
		const chunks = await request(mediaAssetChunks.getAll()) as Array<Record<string, unknown>>;
		await request(mediaAssetChunks.put({ ...chunks[0], payloadEncoding: 'unknown' }));
	});
	await assert.rejects(inspector(fixture).inspect(fixture.binding), TypeError);
});

test('a missing canonical IndexedDB chunk is detected when another real part remains', async t => {
	const fixture = await createRepairFixture(t, 'chunks');
	const body = new Blob([new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES), 'tail']);
	const binding = { ...fixture.binding, photoId: 'large-photo', assetId: 'large-original', sourceId: 'large-logical',
		sha256: await digestMediaContent(body), size: body.size };
	const writer = await fixture.media.beginAssetWrite(binding.assetId, { name: binding.name, mimeType: binding.mimeType },
		{ expectedBytes: binding.size, expectedSha256: binding.sha256 });
	for (let start = 0; start < body.size; start += MEDIA_ASSET_STREAM_CHUNK_BYTES) {
		await writer.write(new Uint8Array(await body.slice(start, start + MEDIA_ASSET_STREAM_CHUNK_BYTES).arrayBuffer()));
	}
	await writer.commit();
	await fixture.media.catalogOriginals.retain(binding.catalogId, [{ photoId: binding.photoId, assetId: binding.assetId,
		sourceId: binding.sourceId, sha256: binding.sha256, size: binding.size }]);
	assert.deepEqual(await inspector(fixture).inspect(binding), { status: 'present' });
	await transact(fixture.database, ['mediaAssets', 'mediaAssetChunks'], 'readwrite', async ({ mediaAssets, mediaAssetChunks }) => {
		const record = await request(mediaAssets.get(binding.assetId)) as Record<string, unknown>;
		await request(mediaAssetChunks.delete(mediaAssetChunkKey(String(record.mediaChunkToken), 0)));
	});
	assert.deepEqual(await inspector(fixture).inspect(binding), { status: 'missing', reason: 'chunk' });
});

test('invalid options and accessor signals reject before lifecycle or storage admission', async t => {
	const fixture = await createRepairFixture(t), service = inspector(fixture);
	let invoked = false;
	const getter = Object.defineProperty({}, 'signal', { enumerable: true, get() { invoked = true; throw new Error('Do not invoke.'); } });
	for (const options of [{ extra: true }, { signal: {} }, getter]) {
		fixture.transactions.length = 0;
		await assert.rejects(service.inspect(fixture.binding, options as never), TypeError);
		assert.deepEqual(fixture.transactions, []);
	}
	assert.equal(invoked, false);
});

test('maintenance joins a held strict body read and refuses its late success', async t => {
	const fixture = await createRepairFixture(t, 'opfs'), lifecycle = new MediaAssetLifecycleCoordinator();
	const entered = deferred(), held = deferred(), service = inspector(fixture, lifecycle);
	fixture.storage.inspectBinaryRecord = async () => { entered.resolve(); await held.promise; return { status: 'present', body: new Blob([Uint8Array.of(1, 3, 5, 7)]) }; };
	let settled = false;
	const pending = service.inspect(fixture.binding);
	const refused = assert.rejects(pending, { name: 'AbortError' });
	await entered.promise;
	const maintenance = lifecycle.beginMaintenance({ permanent: true }), joining = maintenance.abortActive();
	void joining.then(() => { settled = true; }, () => { settled = true; });
	await Promise.resolve(); assert.equal(settled, false);
	held.resolve(); await refused; await joining;
	assert.equal(settled, true);
	await assert.rejects(service.inspect(fixture.binding), /closed/u);
});

test('inspection hashes through bounded slices and joins cancellation during a held slice', async t => {
	const fixture = await createRepairFixture(t, 'opfs'), entered = deferred(), held = deferred(), controller = new AbortController();
	const reads: number[] = [];
	fixture.storage.inspectBinaryRecord = async () => ({ status: 'present', body: {
		size: fixture.binding.size, arrayBuffer: () => { throw new Error('Whole body read forbidden.'); },
		slice(start = 0, end = fixture.binding.size) {
			reads.push(end - start); return { size: end - start, slice: this.slice,
				async arrayBuffer() { entered.resolve(); await held.promise; return Uint8Array.of(1, 3, 5, 7).buffer; } };
		},
	} });
	let settled = false;
	const pending = inspector(fixture).inspect(fixture.binding, { signal: controller.signal });
	void pending.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; controller.abort(new Error('Cancel held digest.'));
	await Promise.resolve(); assert.equal(settled, false);
	held.resolve(); await assert.rejects(pending, error => error === controller.signal.reason);
	assert.equal(settled, true); assert.ok(reads.every(bytes => bytes <= MEDIA_CONTENT_DIGEST_CHUNK_BYTES));
});

test('the media facade borrows its shared maintenance lifetime for original inspection', async t => {
	const fixture = await createRepairFixture(t, 'opfs'), entered = deferred(), held = deferred();
	assert.deepEqual(await fixture.media.inspectCatalogOriginalBody(fixture.binding), { status: 'present' });
	fixture.storage.inspectBinaryRecord = async () => { entered.resolve(); await held.promise; return { status: 'present', body: new Blob([Uint8Array.of(1, 3, 5, 7)]) }; };
	const pending = fixture.media.inspectCatalogOriginalBody(fixture.binding);
	const refused = assert.rejects(pending, { name: 'AbortError' });
	await entered.promise;
	let settled = false;
	const joining = fixture.media.beginAssetMaintenance({ permanent: true }).abortActive();
	void joining.then(() => { settled = true; }, () => { settled = true; });
	await Promise.resolve(); assert.equal(settled, false);
	held.resolve(); await refused; await joining; assert.equal(settled, true);
	await assert.rejects(fixture.media.inspectCatalogOriginalBody(fixture.binding), /closed/u);
});
