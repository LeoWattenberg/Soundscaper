/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoLibraryNamespaceLocksV1, withPhotoLibraryRestoreLockV1, withPhotoLibraryLegacyCatalogLockV1,
	withPhotoLibraryInitializationLockV1,
	type PhotoLibraryWriteAuthorityV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
function fixture(refuse?: string) {
	const calls: string[] = [], releases: string[] = [];
	let terminal: Promise<void> | null = null, terminalFailure: unknown;
	const port = { async request(name: string, _options: unknown,
		operation: (lock: Readonly<{ name: string; mode: 'exclusive' }> | null) => Promise<unknown>) {
		calls.push(name);
		try {
			const result = await operation(name === refuse ? null : { name, mode: 'exclusive' });
			if (terminal) await terminal;
			if (terminalFailure !== undefined) throw terminalFailure;
			return result;
		} finally { releases.push(name); }
	} };
	return { port: port as unknown as Pick<LockManager, 'request'>, calls, releases,
		hold: (promise: Promise<void>) => { terminal = promise; }, fail: (error: unknown) => { terminalFailure = error; } };
}

test('restore and physical namespace leases are acquired deterministically and joined in reverse order', async () => {
	const locks = fixture(); let authority: PhotoLibraryWriteAuthorityV1 | null = null;
	const result = await withPhotoLibraryRestoreLockV1(locks.port, async restore => {
		restore.assertActive();
		return withPhotoLibraryNamespaceLocksV1(locks.port, ['media', 'catalog'], async current => {
			authority = current; current.assertActive(); return 'ready';
		});
	});
	assert.equal(result, 'ready');
	assert.deepEqual(locks.calls, ['lightscaper-photo-library:restore',
		'lightscaper-photo-library:namespace:catalog', 'lightscaper-photo-library:namespace:media']);
	assert.deepEqual(locks.releases, [...locks.calls].reverse());
	assert.throws(() => (authority as PhotoLibraryWriteAuthorityV1 | null)?.assertActive(), /closed/iu);
});

test('a busy physical namespace refuses work and releases already admitted leases', async () => {
	const locks = fixture('lightscaper-photo-library:namespace:media'); let entered = false;
	await assert.rejects(withPhotoLibraryNamespaceLocksV1(locks.port, ['catalog', 'media'], async () => {
		entered = true;
	}), /another window/iu);
	assert.equal(entered, false); assert.deepEqual(locks.releases, [...locks.calls].reverse());
});

test('captured native lock requests remain authoritative when the injected port is replaced', async () => {
	const locks = fixture(); const original = locks.port.request;
	locks.port.request = (async (...args: unknown[]) => {
		locks.port.request = () => Promise.reject(new Error('Replacement port was used.'));
		return Reflect.apply(original, locks.port, args) as Promise<unknown>;
	}) as LockManager['request'];
	assert.equal(await withPhotoLibraryNamespaceLocksV1(locks.port, ['catalog', 'media'], async () => 7), 7);
	assert.equal(locks.calls.length, 2);
});

test('opaque cancellation joins admitted work without inspecting its reason', async () => {
	const locks = fixture(), stop = new AbortController(), entered = deferred<void>(), held = deferred<void>();
	let inspected = 0, settled = false, failure: unknown;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Reason read.'); },
		getPrototypeOf() { inspected++; throw new Error('Reason prototype read.'); } });
	const running = withPhotoLibraryNamespaceLocksV1(locks.port, ['catalog', 'media'], async authority => {
		entered.resolve(); await held.promise; authority.assertActive();
	}, stop.signal).then(() => { settled = true; }, error => { failure = error; settled = true; });
	await entered.promise; stop.abort(reason); await Promise.resolve();
	assert.equal(settled, false); assert.equal(locks.releases.length, 0);
	held.resolve(); await running;
	assert.equal(failure, reason); assert.equal(inspected, 0); assert.equal(locks.releases.length, 2);
});

test('native lease completion is joined and late cancellation preserves an acknowledged result', async () => {
	const locks = fixture(), stop = new AbortController(), completed = deferred<void>(), held = deferred<void>();
	locks.hold(held.promise); let authority: PhotoLibraryWriteAuthorityV1 | null = null, settled = false;
	const receipt = Object.freeze({ status: 'acknowledged' });
	const running = withPhotoLibraryRestoreLockV1(locks.port, async current => {
		authority = current; completed.resolve(); return receipt;
	}, stop.signal).then(result => { settled = true; return result; });
	await completed.promise; await Promise.resolve(); stop.abort();
	assert.equal(settled, false);
	assert.throws(() => (authority as PhotoLibraryWriteAuthorityV1 | null)?.assertActive(), /closed|abort/iu);
	held.resolve(); assert.equal(await running, receipt);
});

test('absent browser locks and pre-cancelled work refuse storage admission', async () => {
	await assert.rejects(withPhotoLibraryRestoreLockV1(null, async () => undefined), /browser.*locks/iu);
	const locks = fixture(), stop = new AbortController(), reason = new Error('Stop before acquisition.'); stop.abort(reason);
	await assert.rejects(withPhotoLibraryNamespaceLocksV1(locks.port, ['catalog', 'media'], async () => undefined, stop.signal),
		(error: unknown) => error === reason);
	assert.deepEqual(locks.calls, []);
});

test('native cleanup errors remain observable after the operation authority has retired', async () => {
	const locks = fixture(), cleanup = new Error('Native lease release failed.'); locks.fail(cleanup);
	let authority: PhotoLibraryWriteAuthorityV1 | null = null;
	await assert.rejects(withPhotoLibraryRestoreLockV1(locks.port, async current => {
		authority = current; return 'acknowledged';
	}), (error: unknown) => error === cleanup);
	assert.throws(() => (authority as PhotoLibraryWriteAuthorityV1 | null)?.assertActive(), /closed/iu);
});

test('initialization and legacy mutation use the established shared catalog lock names', async () => {
	const locks = fixture();
	await withPhotoLibraryInitializationLockV1(locks.port, async () => undefined);
	await withPhotoLibraryLegacyCatalogLockV1(locks.port, 'catalog', async () => undefined);
	assert.deepEqual(locks.calls, ['lightscaper-photo-catalog:photo-library-default', 'lightscaper-photo-catalog:catalog']);
});
