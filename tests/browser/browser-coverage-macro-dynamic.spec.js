/* SPDX-License-Identifier: AGPL-3.0-only */

import { test, expect } from './helpers/browser-coverage-fixture.js';

import { buildMacroSandboxModule } from '../../src/common/editor/macro-script/sandbox-client.ts';
import {
	createPlaywrightBrowserServiceWorkerCoverageCollector,
} from '../../scripts/lib/browser-service-worker-coverage.mjs';

test.use({ browserCoverage: false });

test('worker coverage captures the exact attested macro module source', async ({ browser, browserName, context, page }) => {
	test.skip(browserName !== 'chromium', 'V8 precise coverage is Chromium-only.');

	const pageUrl = '/coverage-macro-dynamic.html';
	const preludeUrl = '/coverage-macro-prelude.js';
	await context.route(`**${pageUrl}`, (route) => route.fulfill({
		body: '<!doctype html><title>coverage macro dynamic source</title>',
		contentType: 'text/html; charset=utf-8',
	}));
	await context.route(`**${preludeUrl}`, (route) => route.fulfill({
		body: 'globalThis.__macroBoot = async (main) => { await main({}); postMessage("macro-ran"); };',
		contentType: 'text/javascript; charset=utf-8',
	}));
	await page.goto(pageUrl);
	const absolutePreludeUrl = new URL(preludeUrl, page.url()).href;
	const source = buildMacroSandboxModule(
		`import ${JSON.stringify(absolutePreludeUrl)};`,
		'globalThis.__macroCoverageExecuted = true;',
	);
	const sourceUrl = /\/\/# sourceURL=(\S+)\n$/u.exec(source)?.[1];
	expect(sourceUrl).toBeTruthy();
	const collector = await createPlaywrightBrowserServiceWorkerCoverageCollector({
		browser,
		captureSource: () => true,
		targetTypes: ['worker'],
	});
	await collector.start();
	try {
		const result = await page.evaluate((moduleSource) => new Promise((resolve, reject) => {
			const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
			const worker = new Worker(moduleUrl, { type: 'module' });
			worker.onmessage = ({ data }) => {
				globalThis.coverageMacroWorker = { moduleUrl, worker };
				resolve(data);
			};
			worker.onerror = (event) => reject(new Error(event.message));
		}), source);
		expect(result).toBe('macro-ran');
		await collector.checkpoint();
		await page.evaluate(() => {
			globalThis.coverageMacroWorker.worker.terminate();
			URL.revokeObjectURL(globalThis.coverageMacroWorker.moduleUrl);
			delete globalThis.coverageMacroWorker;
			});
			const capture = await collector.collect();
			expect(capture.entries.map((entry) => entry.url)).toContain(sourceUrl);
			expect(capture.entries.map((entry) => entry.url)).toContain(absolutePreludeUrl);
			expect(capture.sources.get(sourceUrl)).toBe(source);
			expect(capture.sources.get(absolutePreludeUrl)).toContain('__macroBoot');
			expect(capture.pausedTargetCounts).toEqual({ worker: 1 });
	} finally {
		if (!collector.collected()) await collector.collect();
	}
});
