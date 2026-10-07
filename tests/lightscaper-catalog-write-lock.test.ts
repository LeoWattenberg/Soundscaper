/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoCatalogWriteLockV1 } from '../src/lightscaper/import/catalog-write-lock-v1.ts';

function browserLocks() {
	const active = new Set<string>();
	const names: string[] = [];
	return { names, active, locks: {
		async request(name: string, options: Readonly<{ ifAvailable?: boolean; signal?: AbortSignal }>,
			callback: (lock: Readonly<{ name: string; mode: 'exclusive' }> | null) => Promise<void>): Promise<void> {
			names.push(name);
			if (active.has(name)) {
				if (options.ifAvailable) return callback(null);
				return new Promise((_resolve, reject) => {
					const abort = () => { reject(options.signal?.reason); };
					if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
				});
			}
			active.add(name);
			try { await callback({ name, mode: 'exclusive' }); }
			finally { active.delete(name); }
		},
	} };
}

async function withNavigator<Result>(value: unknown, operation: () => Promise<Result>): Promise<Result> {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
	try { return await operation(); }
	finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

test('managed catalog ownership requires authoritative locks and refuses before the operation', async () => {
	await withNavigator({}, async () => {
		await assert.rejects(withPhotoCatalogWriteLockV1('catalog-1', async () => { assert.fail('Unavailable authority must not enter an operation.'); }), /requires browser project locks/iu);
	});
});

test('catalog writes use the Lightscaper namespace and release the shared lease after a failure', async () => {
	const f = browserLocks(); const failure = new Error('photo publication failed');
	await withNavigator({ locks: f.locks }, async () => {
		await assert.rejects(withPhotoCatalogWriteLockV1('catalog-1', async () => { throw failure; }), (error: unknown) => error === failure);
		assert.equal(f.active.size, 0);
		assert.equal(await withPhotoCatalogWriteLockV1('catalog-1', async () => 'new writer'), 'new writer');
	});
	assert.equal(f.names.every((name) => name === 'lightscaper-photo-catalog:catalog-1'), true);
});

test('a second window refuses the occupied catalog without entering its operation', { timeout: 2_000 }, async () => {
	const f = browserLocks();
	await withNavigator({ locks: f.locks }, async () => {
		let entered!: () => void, release!: () => void;
		const ready = new Promise<void>((resolve) => { entered = resolve; });
		const hold = new Promise<void>((resolve) => { release = resolve; });
		const first = withPhotoCatalogWriteLockV1('catalog-1', async () => { entered(); await hold; });
		try {
			await ready;
			await assert.rejects(withPhotoCatalogWriteLockV1('catalog-1', async () => { assert.fail('Busy catalog operation must not run.'); }), /Another window/iu);
			assert.equal(f.active.size, 1);
		} finally { release(); await first; }
		assert.equal(f.active.size, 0);
	});
});

test('a shared lease takeover aborts the admitted photo operation', { timeout: 2_000 }, async () => {
	const f = browserLocks();
	await withNavigator({ locks: f.locks }, async () => {
		const channel = new BroadcastChannel('lightscaper-photo-catalog:catalog-1');
		try {
			await assert.rejects(withPhotoCatalogWriteLockV1('catalog-1', async (signal) => {
				assert.ok(signal);
				const canceled = new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve(); }, { once: true }); });
				channel.postMessage({ type: 'takeover', owner: 'another-window' });
				await canceled;
				signal.throwIfAborted();
			}), { name: 'AbortError' });
		} finally { channel.close(); }
		assert.equal(f.active.size, 0);
	});
});
