/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page, TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expectedBrowserCoverageRevision } from '../../../scripts/lib/browser-build-source-revision.mjs';
import { test as base } from './browser-coverage-fixture.js';
import { test as desktopBase } from './desktop-speed-warmup-fixture.js';
import { createMotionLinkedOrigins, type MotionLinkedSite } from './motionscaper-linked-origins.ts';
export { expect, withBrowserCoverageContext } from './browser-coverage-fixture.js';
type Origins = Awaited<ReturnType<typeof createMotionLinkedOrigins>>;

async function ownOrigins(use: (origins: Origins) => Promise<void>, info: TestInfo): Promise<void> {
	if (info.config.workers !== 1) throw new Error('Fixed linked origins require one serialized worker.');
	const sites = (info.project.use as { browserCoverageSites?: MotionLinkedSite[] }).browserCoverageSites;
	if (!sites) throw new Error('Linked origin build authority is absent.');
	const revision = await expectedBrowserCoverageRevision(resolve(import.meta.dirname, '../../..'));
	const origins = await createMotionLinkedOrigins(sites, revision);
	try { await use(origins); } finally { await origins.dispose(); }
}

// Automatic test fixtures precede context/page fixtures and tear down after their collectors.
export const test = base.extend<{ linkedOrigins: Origins }>({
	// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
	linkedOrigins: [async ({}, use, info) => { await ownOrigins(use, info); }, { auto: true }],
});
export const audioTest = desktopBase.extend<{ linkedOrigins: Origins }>({
	// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
	linkedOrigins: [async ({}, use, info) => { await ownOrigins(use, info); }, { auto: true }],
});

/** Read cached bytes only: the fixture must never warm fonts to conceal first-load misses. */
export async function inspectLinkedOfflineReadiness(page: Page, site: MotionLinkedSite) {
	interface Asset { url: string; byteLength: number; sha256: string }
	const manifest = JSON.parse(await readFile(resolve(site.outputDirectory, 'offline-shell.json'), 'utf8')) as {
		assets: Asset[]; workers: Record<string, { scriptUrl: string; releaseId: string }>;
	};
	const worker = manifest.workers[site.productId];
	if (!worker || !/^[a-f0-9]{64}$/u.test(worker.releaseId)) throw new Error('Current shell release is absent.');
	await page.waitForFunction(() => ['complete', 'failed'].includes(document.documentElement.dataset.offlineUsedFonts ?? ''), undefined, { timeout: 30_000 });
	return page.evaluate(async ({ origin, productId, worker: expectedWorker, assets }) => {
		if (location.origin !== origin || document.documentElement.dataset.offlineUsedFonts !== 'complete') throw new Error('Used-font handoff did not complete.');
		const controller = navigator.serviceWorker.controller;
		const registration = await navigator.serviceWorker.getRegistration(location.href);
		if (!controller || controller.scriptURL !== new URL(expectedWorker.scriptUrl, origin).href || controller !== registration?.active
			|| registration.installing || registration.waiting) throw new Error('Current own worker does not control this document.');
		const used = JSON.parse(document.documentElement.dataset.offlineUsedFontUrls ?? 'null') as string[] | null;
		if (!Array.isArray(used) || used.length < 1 || used.length > 32 || new Set(used).size !== used.length) throw new Error('Cold-load font evidence is absent or unbounded.');
		const name = `soundscaper-application-shell-v2-${productId}-${expectedWorker.releaseId}`;
		if (!(await caches.keys()).includes(name)) throw new Error('Current verified shell cache is absent.');
		const cache = await caches.open(name);
		const completion = await cache.match(`/.soundscaper/offline/application-shell-v2-${productId}-${expectedWorker.releaseId}.json`);
		const record = await completion?.json() as { schemaVersion?: number; productId?: string; releaseId?: string } | undefined;
		if (!record || record.schemaVersion !== 2 || record.productId !== productId || record.releaseId !== expectedWorker.releaseId
			|| Object.keys(record).length !== 3) throw new Error('Current shell completion identity is absent.');
		const verified = [];
		for (const url of [...used, location.href]) {
			const parsed = new URL(url); if (parsed.origin !== origin) throw new Error('Foreign replay evidence.');
			const asset = assets.find(item => item.url === parsed.pathname);
			if (!asset || asset.byteLength > 25 * 1024 * 1024) throw new Error('Used asset is outside the verified build.');
			const response = await cache.match(asset.url);
			if (response?.status !== 200) throw new Error(`Used asset was not retained: ${asset.url}`);
			const body = await response.arrayBuffer();
			const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(value => value.toString(16).padStart(2, '0')).join('');
			if (body.byteLength !== asset.byteLength || sha256 !== asset.sha256) throw new Error(`Cached asset differs from current build: ${asset.url}`);
			verified.push({ url: asset.url, byteLength: body.byteLength, sha256 });
		}
		return { releaseId: expectedWorker.releaseId, controller: controller.scriptURL, cacheName: name, verified };
	}, { origin: site.origin, productId: site.productId, worker, assets: manifest.assets });
}
