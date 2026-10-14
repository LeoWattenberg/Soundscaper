/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import { recordBrowserProductSiteEvidence } from '../scripts/lib/browser-product-test-sites.mjs';
import { NIGHTLY_BROWSER_SITES, verifyNightlyBrowserSites } from '../scripts/verify-nightly-browser-sites.mjs';

test('nightly artifacts retain both products at all four ordinary and reciprocal origins', () => {
	assert.deepEqual(NIGHTLY_BROWSER_SITES.map(site => [site.productId, site.origin, site.peerOrigin, site.outputDirectory]), [
		['soundscaper', 'http://127.0.0.1:4322', 'http://127.0.0.1:4323', '.wrangler/browser-products/soundscaper'],
		['framescaper', 'http://127.0.0.1:4323', 'http://127.0.0.1:4322', '.wrangler/browser-products/framescaper'],
		['soundscaper', 'http://127.0.0.1:4332', 'http://127.0.0.1:4333', '.wrangler/dual-origin-browser/soundscaper'],
		['framescaper', 'http://127.0.0.1:4333', 'http://127.0.0.1:4332', '.wrangler/dual-origin-browser/framescaper'],
	]);
});

test('every downloaded profile authenticates source revision, product, origin, files and sibling maps', async context => {
	await mkdir(resolve('.wrangler'), { recursive: true });
	const root = await mkdtemp(resolve('.wrangler/nightly-sites-reuse-test-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const outputRoot = relative(resolve('.'), root).split('\\').join('/');
	const sites = NIGHTLY_BROWSER_SITES.map((site, index) => ({ ...site,
		outputDirectory: `${outputRoot}/${String(index)}` as const,
	}));
	for (const site of sites) {
		const output = resolve(site.outputDirectory);
		await mkdir(resolve(output, 'en'), { recursive: true });
		await mkdir(`${output}-source-maps`);
		for (const [file, bytes] of [['_headers', 'headers'], ['_redirects', 'redirects'], ['offline-shell.json', '{}'],
			['service-worker.js', 'service worker'], [`manifest-${site.productId}.webmanifest`, '{}'],
			['en/index.html', `<html data-product="${site.productId}"></html>`]]) await writeFile(resolve(output, file), bytes);
		await writeFile(resolve(`${output}-source-maps`, 'worker.js.map'), '{}');
		await recordBrowserProductSiteEvidence(site);
	}
	await assert.doesNotReject(() => verifyNightlyBrowserSites(sites));
	for (const site of sites) {
		const evidence = resolve(site.outputDirectory, '.browser-product-build.json');
		const original = await readFile(evidence, 'utf8');
		for (const mutation of [{ sourceRevision: '0'.repeat(40) }, { productId: 'other' }, { origin: 'http://127.0.0.1:4999' }]) {
			await writeFile(evidence, JSON.stringify({ ...JSON.parse(original) as Record<string, unknown>, ...mutation }));
			await assert.rejects(() => verifyNightlyBrowserSites(sites), /wrong build/u);
		}
		await writeFile(evidence, original);
		const map = resolve(`${site.outputDirectory}-source-maps`, 'worker.js.map');
		await writeFile(map, 'changed map');
		await assert.rejects(() => verifyNightlyBrowserSites(sites), /source map changed/u);
		await writeFile(map, '{}');
		await writeFile(resolve(site.outputDirectory, 'extra.js'), 'unrecorded');
		await assert.rejects(() => verifyNightlyBrowserSites(sites), /incomplete file inventory/u);
		await rm(resolve(site.outputDirectory, 'extra.js'));
	}
});
