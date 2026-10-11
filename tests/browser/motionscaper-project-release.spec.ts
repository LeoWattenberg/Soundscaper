/* SPDX-License-Identifier: AGPL-3.0-only */
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type * as Store from '../../src/motionscaper/editor-project-store.ts';

test('Motion aborted native IndexedDB release retains its physical lock until durable retry completes', async ({ page }) => {
	const root = '/__motion-release-retry__';
	const script = buildSync({ stdin: { contents: "export * from '../../src/motionscaper/editor-project-store.ts';",
		resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', target: 'es2022' }).outputFiles[0]!.text;
	await page.route(`**${root}/**`, route => route.fulfill({ contentType: route.request().url().endsWith('fixture.js') ? 'text/javascript' : 'text/html',
		body: route.request().url().endsWith('fixture.js') ? script : '<!doctype html><title>Motion durable release</title>' }));
	await page.goto(`${root}/`);
	const result = await page.evaluate(async path => {
		const { createMotionscaperProjectStore } = await import(path) as typeof Store;
		const first = createMotionscaperProjectStore(), second = createMotionscaperProjectStore();
		const id = 'native-release-retry', name = `kw-media-motionscaper-editor-v1-lock:${id}`;
		const held = async () => (await navigator.locks.query()).held?.filter(lock => lock.name === name).length ?? 0;
		const original = IDBObjectStore.prototype.delete; let abort = true;
		IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange): IDBRequest<undefined> {
			const request = original.call(this, key);
			if (this.name === 'writeLeases' && key === id && abort) { abort = false; this.transaction.abort(); }
			return request;
		};
		try {
			const lease = await first.acquireWriteAccess(id);
			const failed = await first.releaseWriteAccess(lease).then(() => false, () => true);
			const heldAfterFailure = await held();
			const staleWriteRefused = await first.assertWriteAccess(lease).then(() => false, () => true);
			const peerRefused = await second.acquireWriteAccess(id).then(() => false, () => true);
			await first.releaseWriteAccess(lease); const heldAfterRetry = await held();
			const next = await second.acquireWriteAccess(id); const heldByNext = await held(); await second.releaseWriteAccess(next);
			return { failed, heldAfterFailure, staleWriteRefused, peerRefused, heldAfterRetry, heldByNext, heldAtEnd: await held(), abortedNativeTransaction: !abort };
		} finally { IDBObjectStore.prototype.delete = original; await first.close(); await second.close(); }
	}, `${root}/fixture.js`);
	expect(result).toEqual({ failed: true, heldAfterFailure: 1, staleWriteRefused: true, peerRefused: true,
		heldAfterRetry: 0, heldByNext: 1, heldAtEnd: 0, abortedNativeTransaction: true });
});
