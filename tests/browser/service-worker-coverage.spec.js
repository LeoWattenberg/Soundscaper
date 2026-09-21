/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createPlaywrightBrowserServiceWorkerCoverageCollector,
} from '../../scripts/lib/browser-service-worker-coverage.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';

test.use({ browserCoverage: false, serviceWorkers: 'allow' });

test('browser-target coverage starts before a service worker lifecycle executes', async ({ browser, browserName, context, page }) => {
	test.skip(browserName !== 'chromium', 'Browser-target service-worker coverage requires Chromium CDP sessions.');
	const workerUrl = '/coverage-service-worker/sw.js';
	const workerSource = [
		'globalThis.coverageLifecycle = { installed: false, activated: false };',
		'self.addEventListener("install", (event) => {',
		'\tcoverageLifecycle.installed = true;',
		'\tevent.waitUntil(self.skipWaiting());',
		'});',
		'self.addEventListener("activate", (event) => {',
		'\tcoverageLifecycle.activated = true;',
		'\tevent.waitUntil(self.clients.claim());',
		'});',
		'self.addEventListener("message", (event) => {',
		'\tconst branch = event.data === "covered" ? "covered" : "alternate";',
		'\tevent.source.postMessage({ ...coverageLifecycle, branch });',
		'});',
	].join('\n');
	await context.route('**/coverage-service-worker/page.html', (route) => route.fulfill({
		body: '<!doctype html><title>coverage service worker</title>',
		contentType: 'text/html; charset=utf-8',
	}));
	await context.route(`**${workerUrl}`, (route) => route.fulfill({
		body: workerSource,
		contentType: 'text/javascript; charset=utf-8',
		headers: { 'Service-Worker-Allowed': '/coverage-service-worker/' },
	}));

	const collector = await createPlaywrightBrowserServiceWorkerCoverageCollector({ browser });
	await collector.start();
	try {
		await page.goto('/coverage-service-worker/page.html');
		const outcomes = await page.evaluate(async (scriptUrl) => {
			const registration = await navigator.serviceWorker.register(scriptUrl, {
				scope: '/coverage-service-worker/',
				updateViaCache: 'none',
			});
			await navigator.serviceWorker.ready;
			const request = (value) => new Promise((resolve) => {
				navigator.serviceWorker.addEventListener('message', (event) => resolve(event.data), { once: true });
				registration.active.postMessage(value);
			});
			return [await request('covered'), await request('other')];
		}, workerUrl);
		expect(outcomes).toEqual([
			{ installed: true, activated: true, branch: 'covered' },
			{ installed: true, activated: true, branch: 'alternate' },
		]);

		const capture = await collector.collect();
		const entries = capture.entries.filter(({ url }) => url.endsWith(workerUrl));
		expect(entries).toHaveLength(1);
		expect(entries[0].functions.some(({ ranges }) => (
			ranges.some(({ count, startOffset }) => count > 0 && startOffset === 0)
		))).toBe(true);
		expect(entries[0].functions.filter(({ isBlockCoverage, ranges }) => (
			isBlockCoverage && ranges.some(({ count }) => count > 0)
		)).length).toBeGreaterThanOrEqual(3);
		expect(capture.sources.get(entries[0].url)).toBe(workerSource);
		expect(capture.pausedTargetCounts).toEqual({ service_worker: 1 });
	} finally {
		if (!collector.collected()) await collector.collect();
	}
});
