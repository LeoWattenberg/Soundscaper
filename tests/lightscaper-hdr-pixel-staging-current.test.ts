/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { withImageHdrPixelStagingV1, type ImageHdrPixelStagingStoreV1 } from '../src/common/editor/storage/image-hdr-pixel-staging-v1.ts';
import { hdrOpfsStagingFixture } from './helpers/lightscaper-hdr-opfs-staging-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const MiB = 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('HDR pixel staging uses existing native binary storage and leases, bounded verified ranges, and exact physical retirement', async () => {
	const f = hdrOpfsStagingFixture(), source = Uint8Array.of(1, 3, 5, 7, 9); let borrowed: Uint8Array | undefined, retained: Readonly<ImageHdrPixelStagingStoreV1> | undefined;
	const result = await withImageHdrPixelStagingV1(async store => {
		retained = store; const handle = await store.write(5, async writer => { await writer.write(source.subarray(0, 2)); await writer.write(source.subarray(2)); });
		assert.ok(Object.isFrozen(handle)); assert.deepEqual(handle, { byteLength: 5, sha256: hash(source) }); assert.equal(f.files.size, 1);
		await store.withRead(handle, 1, 3, bytes => { borrowed = bytes; assert.deepEqual([...bytes], [3, 5, 7]); assert.equal(bytes.buffer.byteLength, 3); });
		assert.ok(borrowed?.every(value => value === 0)); return 'merged';
	}, { backend: f.backend, acquireLease: f.acquireLease });
	assert.equal(result, 'merged'); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0); assert.equal(f.closed, true);
	assert.ok(retained); await assert.rejects(retained.write(1, async () => undefined), /closed|retired/iu);
	assert.ok(f.events.findIndex(event => event.startsWith('delete:')) < f.events.findIndex(event => event.startsWith('release:')));
});

test('HDR staging joins an accepted abandoned write before deletion and preserves the opaque consumer reason', async () => {
	const f = hdrOpfsStagingFixture(), entered = deferred<void>(), release = deferred<void>(), reason = Object.freeze({ cancelled: 'consumer' });
	f.hooks.write = async () => { entered.resolve(); await release.promise; }; let abandoned: Promise<unknown> | undefined;
	const operation = withImageHdrPixelStagingV1(async store => {
		abandoned = store.write(3, async writer => { await writer.write(Uint8Array.of(2, 4, 6)); });
		await entered.promise; throw reason;
	}, { backend: f.backend, acquireLease: f.acquireLease });
	const outcome = operation.then(value => ({ value }), (error: unknown) => ({ error }));
	try { await entered.promise; assert.equal(await remainsPending(outcome), true); assert.equal(f.leases.size, 1); assert.equal(f.files.size, 1); }
	finally { release.resolve(); }
	const result = await outcome; assert.ok('error' in result); assert.equal(result.error, reason); await abandoned;
	assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0); assert.equal(f.closed, true);
});

test('HDR staging snapshots each write before native transport yields and wipes scoped range bytes after a held reader joins', async () => {
	const f = hdrOpfsStagingFixture(), entered = deferred<void>(), release = deferred<void>(), readEntered = deferred<void>(), readRelease = deferred<void>();
	f.hooks.write = async () => { entered.resolve(); await release.promise; }; const source = Uint8Array.of(11, 22, 33); let borrowed: Uint8Array | undefined;
	const operation = withImageHdrPixelStagingV1(async store => {
		const handle = await store.write(3, async writer => { const writing = writer.write(source); await entered.promise; source.fill(99); release.resolve(); await writing; });
		return store.withRead(handle, 0, 3, async bytes => { borrowed = bytes; assert.deepEqual([...bytes], [11, 22, 33]); readEntered.resolve(); await readRelease.promise; return 7; });
	}, { backend: f.backend, acquireLease: f.acquireLease });
	try { await readEntered.promise; assert.equal(await remainsPending(operation), true); assert.deepEqual([...borrowed!], [11, 22, 33]); assert.equal(f.files.size, 1); }
	finally { release.resolve(); readRelease.resolve(); }
	assert.equal(await operation, 7); assert.ok(borrowed?.every(value => value === 0)); assert.equal(f.files.size, 0);
});

test('HDR staging surfaces retained-file cleanup failures with the distinct opaque primary and releases ended leases for recovery', async () => {
	const f = hdrOpfsStagingFixture(), primary = Object.freeze({ consumer: 'failed' }), cleanup = Object.freeze({ disk: 'delete denied' });
	f.hooks.remove = async () => { throw cleanup; };
	await assert.rejects(withImageHdrPixelStagingV1(async store => {
		await store.write(1, async writer => { await writer.write(Uint8Array.of(8)); }); throw primary;
	}, { backend: f.backend, acquireLease: f.acquireLease }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.ok(error.errors.includes(primary)); assert.ok(error.errors.includes(cleanup)); return true;
	});
	assert.equal(f.files.size, 1); assert.equal(f.leases.size, 0); assert.equal(f.closed, true);
});

test('HDR staging refuses foreign handles and over-budget ranges without native reads or allocations', async () => {
	const f = hdrOpfsStagingFixture(); let snapshots = 0; f.hooks.snapshot = async () => { snapshots++; };
	await assert.rejects(withImageHdrPixelStagingV1(async store => {
		const handle = await store.write(1, async writer => { await writer.write(Uint8Array.of(5)); }); const before = snapshots;
		await assert.rejects(store.withRead({ ...handle }, 0, 1, () => assert.fail('Foreign handle reached consumer.')), /owner|handle/iu);
		assert.equal(snapshots, before);
		await assert.rejects(store.withRead(handle, 0, MiB + 1, () => assert.fail('Oversized range reached consumer.')), /range|bound|MiB/iu);
	}, { backend: f.backend, acquireLease: f.acquireLease }));
	assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
});

test('HDR staging refuses declarations above canonical-plane capacity before creating a file, and pre-abort wins metadata inspection', async () => {
	const f = hdrOpfsStagingFixture();
	await assert.rejects(withImageHdrPixelStagingV1(async store => { await store.write(128 * MiB + 1, async () => undefined); },
		{ backend: f.backend, acquireLease: f.acquireLease }), /bound|capacity|MiB/iu);
	assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0); assert.equal(f.events.some(event => event.startsWith('create:')), false);
	const abort = new AbortController(), reason = Object.freeze({ stop: 'before metadata' }); abort.abort(reason);
	const options = { signal: abort.signal, get backend() { assert.fail('Pre-abort must win accessor metadata.'); return f.backend; } };
	await assert.rejects(withImageHdrPixelStagingV1(() => assert.fail('Pre-abort reached consumer.'), options), (error: unknown) => error === reason);
});

test('HDR staging requires persistent OPFS before canonical decoding can begin', async () => {
	const f = hdrOpfsStagingFixture(), backend = { ...f.backend, async ready() { return false; } };
	await assert.rejects(withImageHdrPixelStagingV1(() => assert.fail('Unavailable OPFS reached canonical work.'),
		{ backend, acquireLease: f.acquireLease }), /OPFS|persistent/iu);
	assert.equal(f.files.size, 0); assert.equal(f.closed, true);
});

test('HDR staging authenticates the closed native file before issuing an owner handle', async () => {
	const f = hdrOpfsStagingFixture(); let handled = false;
	f.hooks.snapshot = async () => { for (const path of f.files.keys()) f.files.set(path, new Blob([Uint8Array.of(4, 5, 99)])); };
	await assert.rejects(withImageHdrPixelStagingV1(async store => {
		await store.write(3, async writer => { await writer.write(Uint8Array.of(4, 5, 6)); }); handled = true;
	}, { backend: f.backend, acquireLease: f.acquireLease }), /SHA256/iu);
	assert.equal(handled, false); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
});

test('HDR staging joins a held range consumer after opaque cancellation before wiping and deleting', async () => {
	const f = hdrOpfsStagingFixture(), abort = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	const reason = Object.freeze({ user: 'cancel merge' }); let borrowed: Uint8Array | undefined;
	const operation = withImageHdrPixelStagingV1(async store => {
		const handle = await store.write(3, async writer => { await writer.write(Uint8Array.of(17, 18, 19)); });
		return store.withRead(handle, 0, 3, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; return 'late'; });
	}, { backend: f.backend, acquireLease: f.acquireLease, signal: abort.signal });
	const outcome = operation.then(value => ({ value }), (error: unknown) => ({ error }));
	try {
		await entered.promise; abort.abort(reason); assert.equal(await remainsPending(outcome), true);
		assert.deepEqual([...borrowed!], [17, 18, 19]); assert.equal(f.files.size, 1); assert.equal(f.leases.size, 1);
	} finally { release.resolve(); }
	const result = await outcome; assert.ok('error' in result); assert.equal(result.error, reason);
	assert.ok(borrowed?.every(value => value === 0)); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
});

test('HDR staging reports physical detachment of a scoped read and still removes its native file', async () => {
	const f = hdrOpfsStagingFixture();
	await assert.rejects(withImageHdrPixelStagingV1(async store => {
		const handle = await store.write(1, async writer => { await writer.write(Uint8Array.of(21)); });
		await store.withRead(handle, 0, 1, bytes => { const transferred = structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); new Uint8Array(transferred).fill(0); });
	}, { backend: f.backend, acquireLease: f.acquireLease }), /detach|physical/iu);
	assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0); assert.equal(f.closed, true);
});

test('HDR staging pins its native cleanup methods before storage admission yields', async () => {
	const f = hdrOpfsStagingFixture(), entered = deferred<void>(), release = deferred<void>(), initialReady = f.backend.ready;
	f.backend.ready = async () => { entered.resolve(); await release.promise; return initialReady(); };
	const operation = withImageHdrPixelStagingV1(async store => {
		await store.write(1, async writer => { await writer.write(Uint8Array.of(42)); }); return true;
	}, { backend: f.backend, acquireLease: f.acquireLease });
	await entered.promise; f.backend.deletePathExact = async () => { assert.fail('Mutated cleanup method was consulted after admission.'); }; release.resolve();
	assert.equal(await operation, true); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
});

test('HDR staging admits at most nine canonical planes in one scoped operation', async () => {
	const f = hdrOpfsStagingFixture();
	await assert.rejects(withImageHdrPixelStagingV1(async store => {
		for (let index = 0; index < 9; index++) await store.write(1, async writer => { await writer.write(Uint8Array.of(index)); });
		assert.equal(f.files.size, 9);
		await store.write(1, async () => assert.fail('A tenth canonical plane reached its producer.'));
	}, { backend: f.backend, acquireLease: f.acquireLease }), /nine|capacity/iu);
	assert.equal(f.events.filter(event => event.startsWith('create:')).length, 9); assert.equal(f.files.size, 0); assert.equal(f.leases.size, 0);
});
