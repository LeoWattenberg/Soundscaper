/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX,
	createBrowserFfmpegRuntimeStore,
} from '../src/common/offline/browser-runtime-store.ts';
import {
	install,
	MemoryCacheStorage,
	MemoryLockManager,
	release,
	runtimeBodyForFile,
	sequence,
	stagedTransaction,
} from './helpers/offline-browser-runtime-store-fixture.ts';

for (const position of ['active', 'previous'] as const) {
	test(`a conflicting release ID preserves the complete ${position} browser runtime`, async () => {
		const cacheStorage = new MemoryCacheStorage();
		const store = createBrowserFfmpegRuntimeStore({
			cacheStorage,
			lockManager: new MemoryLockManager(),
			origin: 'https://soundscaper.org',
			randomUUID: sequence('first', 'second', 'conflict'),
		});
		const first = release('a');
		await install(store, first);
		const second = release('b');
		if (position === 'previous') await install(store, second);

		const conflict = {
			...first,
			files: [
				{ ...first.files[0]!, sha256: '0'.repeat(64) },
				first.files[1]!,
			],
		};
		const transaction = await stagedTransaction(store, conflict);
		await assert.rejects(transaction.commit(), /release ID conflicts with an installed release/u);
		await transaction.rollback();

		const firstCache = await cacheStorage.open(`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${first.releaseId}`);
		const firstResponse = await firstCache.match(first.files[0]!.url);
		assert.ok(firstResponse, 'the complete runtime cache must still exist');
		assert.deepEqual(
			new Uint8Array(await firstResponse.arrayBuffer()),
			runtimeBodyForFile(first.files[0]!),
		);
		assert.equal((await store.readActive())?.releaseId, position === 'active'
			? first.releaseId : second.releaseId);
	});
}
