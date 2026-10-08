/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const MODULE = '/__lightscaper_restore_ownership.js';
const WORKER = '/__lightscaper_restore_ownership_worker.js';
const ENTRY = new URL('../helpers/lightscaper-restore-ownership-native-fixture.ts', import.meta.url);

test('native allocation creates catalog and media owner markers inside their schema transactions', async ({ page }) => {
	const result = await qualify(page, 'creation');
	expect(result).toEqual({ status: ['owned', 'owned'], markersExact: true, creationModes: ['versionchange', 'versionchange'],
		catalogStores: 16, catalogVersion: 5, mediaVersion: 2, readyRevision: Number.MAX_SAFE_INTEGER, originals: 0 });
});

test('native ownership probes leave absent namespaces absent and preserve earlier, current and future collisions', async ({ page }) => {
	expect(await qualify(page, 'collision')).toEqual({ refusals: ['catalog:1', 'catalog:2', 'catalog:5', 'catalog:6',
		'media:1', 'media:2', 'media:5', 'media:6'], existingUnchanged: true, absentProbeDidNotCreate: true });
});

test('native owner authentication refuses missing and counterfeit markers without repairing or publishing readiness', async ({ page }) => {
	expect(await qualify(page, 'authentication')).toEqual({ refusals: ['catalog:missing', 'catalog:replacement', 'catalog:future-schema',
		'media:missing', 'media:replacement', 'media:future-schema'], auditDidNotRepair: true, cancellations: [true, true] });
});

test('native creation markers survive owner realm retirement and authenticate durable allocation descriptors', async ({ page }) => {
	expect(await qualify(page, 'realm-retirement')).toEqual({ statuses: ['owned', 'owned'], descriptorsExact: true,
		ownerRealmsRetired: true, postOpenRows: [0, 0] });
});

async function qualify(page, mode) {
	test.setTimeout(180_000);
	const diagnostics = [];
	page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
	page.context().on('requestfailed', request => {
		if (request.url().includes('__lightscaper_restore_ownership')) diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`);
	});
	const bundle = await build({ entryPoints: [fileURLToPath(ENTRY)], bundle: true, write: false,
		format: 'esm', platform: 'browser', logLevel: 'silent' });
	const workerBundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', ENTRY)), contents:
		`import { retireAtNativeRestoreCreationV1 } from ${JSON.stringify(fileURLToPath(ENTRY))};
		globalThis.addEventListener('message', event => {
			void retireAtNativeRestoreCreationV1(event.data.allocation, event.data.component).catch(error => {
				globalThis.postMessage({ phase: 'failure', error: String(error) });
			});
		}, { once: true });
		globalThis.postMessage({ phase: 'ready' });` }, bundle: true, write: false,
		format: 'iife', platform: 'browser', logLevel: 'silent' });
	const headers = { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
	await page.context().route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', headers, body: bundle.outputFiles[0].text }));
	await page.context().route(`**${WORKER}`, route => route.fulfill({ contentType: 'text/javascript', headers, body: workerBundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`); await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
	try {
		return await page.evaluate(async ({ path, mode, workerPath }) => (await import(new URL(path, location.href).href))
			.qualifyNativeRestoreOwnershipV1(mode, new URL(workerPath, location.href).href), { path: MODULE, mode, workerPath: WORKER });
	} catch (error) {
		throw new Error(`Native ownership qualification failed: ${diagnostics.join('\n')}`, { cause: error });
	}
}
