/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_managed_import__';

async function routeImport(page) {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-managed-import-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'],
	});
	await page.route(`${ROOT}/**`, async (route) => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Native managed photo import qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
}

async function scenario(page, mode) {
	await routeImport(page);
	return page.evaluate(async ({ root, mode }) => {
		const api = await import(`${root}/entry.js`);
		return api.qualifyManagedImportNativeV1(mode);
	}, { root: ROOT, mode });
}

test('native managed import retains exact originals while deduping two independently authored photos across reopen', async ({ page }) => {
	const result = await scenario(page, 'dedupe');
	expect(result.receipts.map(({ status }) => status)).toEqual(['imported', 'imported']);
	expect(result.receipts.map(({ reusedOriginal }) => reusedOriginal)).toEqual([false, true]);
	expect(result.photoCount).toBe(2);
	expect(result.catalogRevision).toBe(2);
	expect(result.originalIds).toEqual(['source-1', 'source-2']);
	expect(result.storageKeys).toEqual(['original-1', 'original-1']);
	expect(result.ratings).toEqual([4, 1]);
	expect(result.captions).toEqual(['First authored caption', 'Second authored caption']);
	expect(result.permanentPhotos).toEqual(['photo-1', 'photo-2']);
	expect(result.assets).toBe(1);
	expect(result.intent).toBe(false);
	expect(result.deletionRefused).toBe(true);
	expect(result.actualBytes).toEqual(result.expectedBytes);
	expect(result.inventoryCalls).toEqual([]);
});

test('native recovery releases an unpublished stage after reopen and preserves another catalog original', async ({ page }) => {
	const result = await scenario(page, 'staged-abort');
	expect(result.competingRecovery).toContain('Another window');
	expect(result.stagedWhileLocked).toBe(1);
	expect(result.intentWhileLocked).toBe(true);
	expect(result.interruption).toBe('AbortError');
	expect(result.publishedBeforeRecovery).toBe(false);
	expect(result.intentBeforeRecovery).toBe(true);
	expect(result.stagedBeforeRecovery).toBe(1);
	expect(result.stagedAfterRecovery).toBe(0);
	expect(result.permanentPhotos).toEqual([]);
	expect(result.otherPermanentPhotos).toEqual(['photo-2']);
	expect(result.photoCount).toBe(0);
	expect(result.assets).toBe(1);
	expect(result.intent).toBe(false);
	expect(result.deletionRefusedBeforeRecovery).toBe(true);
	expect(result.deletionRefused).toBe(true);
	expect(result.actualBytes).toEqual(result.expectedBytes);
	expect(result.inventoryCalls).toEqual([]);
});

test('native recovery promotes custody after catalogue publication survives cancellation and reopening', async ({ page }) => {
	const result = await scenario(page, 'published-abort');
	expect(result.interruption).toBe('AbortError');
	expect(result.publishedBeforeRecovery).toBe(true);
	expect(result.intentBeforeRecovery).toBe(true);
	expect(result.stagedBeforeRecovery).toBe(1);
	expect(result.stagedAfterRecovery).toBe(0);
	expect(result.permanentPhotos).toEqual(['photo-1']);
	expect(result.photoCount).toBe(1);
	expect(result.assets).toBe(1);
	expect(result.intent).toBe(false);
	expect(result.deletionRefusedBeforeRecovery).toBe(true);
	expect(result.deletionRefused).toBe(true);
	expect(result.actualBytes).toEqual(result.expectedBytes);
	expect(result.inventoryCalls).toEqual([]);
});

test('native publication acknowledgement recovery preserves a subsequently persisted authored edit', async ({ page }) => {
	const result = await scenario(page, 'acknowledgement');
	expect(result.receipts.map(({ status }) => status)).toEqual(['imported']);
	expect(result.photoCount).toBe(1);
	expect(result.photoRevisions).toEqual([1]);
	expect(result.ratings).toEqual([5]);
	expect(result.captions).toEqual(['Authored after durable publication']);
	expect(result.permanentPhotos).toEqual(['photo-1']);
	expect(result.assets).toBe(1);
	expect(result.intent).toBe(false);
	expect(result.deletionRefused).toBe(true);
	expect(result.actualBytes).toEqual(result.expectedBytes);
	expect(result.inventoryCalls).toEqual([]);
});

test('native direct original publication preserves bytes or refuses unsupported Blob storage before catalog publication', async ({ page, browserName }) => {
	const result = await scenario(page, 'direct-writer');
	if (browserName === 'webkit' && result.receipts[0].status === 'failed') {
		expect(result.writerFailure.message).toContain('Blob/File');
		expect(result.photoCount).toBe(0);
		expect(result.assets).toBe(0);
		expect(result.permanentPhotos).toEqual([]);
		expect(result.stagedPhotos).toEqual([]);
		expect(result.intent).toBe(false);
	} else {
		expect(result.receipts.map(({ status }) => status)).toEqual(['imported']);
		expect(result.photoCount).toBe(1);
		expect(result.assets).toBe(1);
		expect(result.actualBytes).toEqual(result.expectedBytes);
		expect(result.permanentPhotos).toEqual(['photo-1']);
		expect(result.deletionRefused).toBe(true);
	}
	expect(result.inventoryCalls).toEqual([]);
});
