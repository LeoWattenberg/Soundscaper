/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaAssetCleanupError } from '../src/common/editor/storage/media-asset-cleanup-error.ts';
import { BrowserFileStorageError } from '../src/common/editor/web-file-limit-failure.ts';
import { assertNoRepairLease, createRepairFixture, REPAIR_BYTES } from './helpers/media-catalog-original-repair-fixture.ts';

for (const failCleanup of [false, true]) {
	test(`cancelled held original staging preserves opaque reason without inspection; cleanup failure=${failCleanup}`, async context => {
		const f = await createRepairFixture(context, 'opfs'), write = f.opfs.hold('write'), stop = new AbortController();
		const row = f.row(), roots = f.roots(); let inspections = 0;
		const reason = new Proxy({}, {
			getPrototypeOf() { inspections++; throw new Error('Opaque native reason prototype was inspected.'); },
			get() { inspections++; throw new Error('Opaque native reason property was inspected.'); },
		});
		const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal });
		let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
		try {
			await write.entered; const abort = f.opfs.hold('abort');
			if (failCleanup) f.opfs.failRemoval();
			stop.abort(reason); write.release(); await abort.entered;
			await Promise.resolve(); assert.equal(settled, false);
			abort.release();
			let rejected = false, failure: unknown;
			try { await pending; } catch (error) { rejected = true; failure = error; }
			assert.equal(rejected, true);
			if (failCleanup) {
				assert.ok(failure instanceof MediaAssetCleanupError);
				assert.equal(failure.errors[0], reason); assert.equal(failure.errors.length, 2);
				assert.ok(failure.errors[1] instanceof MediaAssetCleanupError);
			} else { assert.equal(failure, reason); assertNoRepairLease(f); }
			assert.deepEqual(f.row(), row); assert.deepEqual(f.roots(), roots);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
			assert.equal(inspections, 0);
		} finally { write.release(); await pending.catch(() => undefined); }
	});
}

for (const abortError of [false, true]) {
	test(`an unobserved native write refusal preserves browser classification; AbortError=${abortError}`, async context => {
		const f = await createRepairFixture(context, 'opfs'), stop = new AbortController();
		const row = f.row(), roots = f.roots(), path = 'failed-repair-stage.blob';
		const reason = abortError ? new DOMException('Native writer refused.', 'AbortError') : new Error('Native write fault.');
		f.opfs.files.set(path, new Blob());
		f.storage.planBinaryWriter = async () => ({ path, open: async () => ({ path,
			write: async () => { throw reason; }, close: async () => undefined, abort: async () => undefined }) });
		let rejected = false, failure: unknown;
		try { await f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal }); }
		catch (error) { rejected = true; failure = error; }
		assert.equal(rejected, true); assert.equal(stop.signal.aborted, false);
		if (abortError) assert.equal(failure, reason);
		else { assert.ok(failure instanceof BrowserFileStorageError); assert.equal(failure.cause, reason); }
		assert.deepEqual(f.row(), row); assert.deepEqual(f.roots(), roots);
		assertNoRepairLease(f); assert.equal(f.opfs.files.has(path), false);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	});
}
