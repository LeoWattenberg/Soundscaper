/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from '@playwright/test';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteSourceMapSources } from '../../../scripts/lib/build-source-map-relocation.mjs';
import { collectsBrowserCoverage, createBrowserCoverageCollector } from '../../../scripts/lib/browser-coverage-profile.mjs';
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';
import { assertNativeOpfsWorkerExecution, watchNativeOpfsWorkerExecution } from './native-opfs-worker-companion.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptsByContext = new WeakMap(), collectors = new WeakMap(), installed = new WeakMap();
const bundles = new Map(), writtenSourceMaps = new Set();

// Keep the ordinary collector enabled, including navigation and native worker
// checkpoints. Only these two test-runtime programs use its supplied map seam.
// Their maps support local coverage compaction; they are not production build
// artifacts and must not be submitted as portable production E2E evidence.
export const test = base.extend({
	browserCoverage: [true, { option: true }],
	context: async ({ context, browserName, browserCoverage }, use, testInfo) => {
		const origins = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS) : {};
		const sites = ordinaryBrowserProductSitePlan().sites.map(site => ({ ...site, origin: origins[site.productId] ?? site.origin }));
		const scripts = new Map(); scriptsByContext.set(context, { scripts, origin: sites.find(site => site.productId === 'lightscaper').origin });
		if (!browserCoverage || !collectsBrowserCoverage(browserName)) { await use(context); return; }
		const collector = createBrowserCoverageCollector({ browserName, scripts, sites });
		collectors.set(context, collector); collector.attach(context);
		try { await use(context); }
		finally { await collector.collect(testInfo.titlePath.join(' '), writtenSourceMaps); }
	},
	page: async ({ page }, use) => {
		await collectors.get(page.context())?.settle();
		await use(page);
	},
});
export { expect } from '@playwright/test';

export function installNativeImageHandoffRuntime(page) {
	watchNativeOpfsWorkerExecution(page);
	const prior = installed.get(page); if (prior) return prior;
	const ready = installWorker(page); installed.set(page, ready); return ready;
}

async function installWorker(page) {
	await page.exposeFunction('__assertNativeOpfsWorkerExecution', () => assertNativeOpfsWorkerExecution(page));
	const script = await mappedBundle('opfs-sync-worker.js', resolve(repositoryRoot, 'src/common/editor/storage/opfs-sync-worker.ts'));
	register(page, '/opfs-sync-worker.ts', script);
	await page.route('**/opfs-sync-worker.ts', async route => {
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body: script.source }); }
		finally { await response.dispose(); }
	});
}

export async function observeNativeImageHandoffLibrary(page, ids) {
	const script = await mappedBundle('editable-receive-observer.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-photo-framescaper-receive-observer.js'));
	register(page, '/__editable_receive_observer.js', script);
	await page.route('**/__editable_receive_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	const result = await page.evaluate(async ids => (await import(new URL('/__editable_receive_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent(ids, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return result;
}

function register(page, pathname, script) {
	const captured = scriptsByContext.get(page.context());
	if (!captured) throw new Error('The native image handoff must use its mapped coverage fixture.');
	// The body sent to Playwright is the exact source used by the collector and
	// the map: no omitted native code, synthetic origin, or URL classification.
	captured.scripts.set(new URL(pathname, captured.origin).href, script);
}

function mappedBundle(name, entry) {
	const prior = bundles.get(name); if (prior) return prior;
	const ready = compile(name, entry); bundles.set(name, ready); return ready;
}

async function compile(name, entry) {
	const outfile = resolve(repositoryRoot, '.wrangler/lightscaper-native-test-runtime', name);
	const result = await build({ entryPoints: [entry], outfile, bundle: true, write: false,
		format: 'esm', platform: 'browser', sourcemap: 'external', loader: { '.woff2': 'dataurl' } });
	const source = result.outputFiles.find(file => file.path === outfile)?.text;
	const mapText = result.outputFiles.find(file => file.path === `${outfile}.map`)?.text;
	if (result.outputFiles.length !== 2 || typeof source !== 'string' || typeof mapText !== 'string') throw new Error('Expected an actual mapped native test program.');
	return { path: outfile, source, sourceMap: absoluteSourceMapSources(JSON.parse(mapText), dirname(outfile), repositoryRoot) };
}
