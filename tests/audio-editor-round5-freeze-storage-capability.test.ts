/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { hasDurableMediaStorageCapability } from './browser/helpers/durable-media-storage-capability.js';

test('the original durable-media probe retains its OPFS fast path', async () => {
	let opens = 0;
	const runtime = { navigator: { storage: { getDirectory: async () => ({}) } },
		indexedDB: { open: () => { opens += 1; throw new Error('IDB must remain unused.'); } } };
	assert.equal(await hasDurableMediaStorageCapability(runtime as unknown as typeof globalThis), true);
	assert.equal(opens, 0);
});

test('the exact Freeze backend cannot substitute working OPFS for absent IndexedDB', async context => {
	let opfsCalls = 0;
	install(context, 'navigator', { storage: { getDirectory: async () => { opfsCalls += 1; return {}; } } });
	install(context, 'indexedDB', undefined);
	assert.equal(await hasDurableMediaStorageCapability(), true);
	assert.equal(await hasDurableMediaStorageCapability('indexeddb-only'), false);
	assert.equal(opfsCalls, 1);
});

test('an IndexedDB access refusal is reported without substituting OPFS or leaving probe metadata', async context => {
	const deleted: string[] = [];
	install(context, 'navigator', { storage: { getDirectory: async () => ({}) } });
	install(context, 'indexedDB', { open: () => { throw new DOMException('Storage access refused', 'SecurityError'); },
		deleteDatabase: (name: string) => { deleted.push(name); } });
	assert.equal(await hasDurableMediaStorageCapability('indexeddb-only'), false);
	assert.equal(deleted.length, 1);
	assert.equal(await hasDurableMediaStorageCapability(), true, 'default media storage still admits actual OPFS');
});

function install(context: TestContext, key: 'navigator' | 'indexedDB', value: unknown): void {
	const original = Object.getOwnPropertyDescriptor(globalThis, key);
	Object.defineProperty(globalThis, key, { configurable: true, value });
	context.after(() => {
		if (original) Object.defineProperty(globalThis, key, original);
		else Reflect.deleteProperty(globalThis, key);
	});
}
