/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteSourceMapSources } from '../../../scripts/lib/build-source-map-relocation.mjs';
import { collectsBrowserCoverage, createBrowserCoverageCollector } from '../../../scripts/lib/browser-coverage-profile.mjs';
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';
import { createPffftNodeModuleBrowserShim } from '../../../scripts/vite-pffft-browser-shim.mjs';
import { assertNativeOpfsWorkerExecution, watchNativeOpfsWorkerExecution } from './native-opfs-worker-companion.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptsByContext = new WeakMap(), collectors = new WeakMap(), installed = new WeakMap();
const bundles = new Map(), writtenSourceMaps = new Set();

// Keep the ordinary collector enabled, including navigation and native worker
// checkpoints. These test-runtime programs use its supplied map seam.
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

/** Run the real Frame controller and still importer in this fresh browser
 * context. Playwright supplies the actual browser File picker; the helper
 * closes its controller and storage before any archive bytes leave the page.
 * This covers the Frame owners, not its separate-origin application UI. */
export async function createOrdinaryFramescaperStillArchive(page, file) {
	const script = await mappedBundle('ordinary-frame-still.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-ordinary-framescaper-archive-fixture.js'));
	register(page, '/__ordinary_frame_still_archive.js', script);
	await page.route('**/__ordinary_frame_still_archive.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	await page.evaluate(() => import(new URL('/__ordinary_frame_still_archive.js', location.href).href));
	let choose;
	const waiting = new Promise(resolve => { choose = resolve; });
	const listener = picker => choose(picker); page.once('filechooser', listener);
	const work = page.evaluate(async () => {
		const fixture = await import(new URL('/__ordinary_frame_still_archive.js', location.href).href);
		const { archive, ...facts } = await fixture.createOrdinaryFramescaperStillArchiveFixtureV1();
		return { ...facts, archive: Array.from(new Uint8Array(await archive.arrayBuffer())) };
	});
	const joined = work.then(value => ({ value }), failure => ({ failed: true, failure }));
	let picker, failed = false, primary, cleanup;
	try {
		picker = await Promise.race([waiting, work.then(() => { throw new Error('The real still importer did not open its file picker.'); })]);
		await picker.setFiles(file);
	} catch (error) { failed = true; primary = error; }
	finally { page.off('filechooser', listener); }
	if (failed && picker) {
		// A failed driver must dismiss its actual picker and join the import;
		// controller disposal alone does not settle an outstanding selection.
		try { await picker.setFiles([]); } catch (error) { cleanup = { failure: error }; }
	}
	const result = await joined;
	if (failed) {
		const failures = [primary];
		if (cleanup && !failures.includes(cleanup.failure)) failures.push(cleanup.failure);
		if (result.failed && !failures.includes(result.failure)) failures.push(result.failure);
		if (failures.length > 1) throw new AggregateError(failures, 'Still archive fixture and cleanup failed.', { cause: primary });
		throw primary;
	}
	if (result.failed) throw result.failure;
	await assertNativeOpfsWorkerExecution(page);
	return { ...result.value, archive: Buffer.from(result.value.archive) };
}

export async function observeOrdinaryFramescaperStillProject(page, projectId) {
	const result = await page.evaluate(async id => (await import(new URL('/__ordinary_frame_still_archive.js', location.href).href))
		.readOrdinaryFramescaperStillProjectFixtureV1(id), projectId);
	await assertNativeOpfsWorkerExecution(page); return result;
}

/** Import the actual menu-produced collection with Frame's current owners
 * and render every retained recipe, closing all readers/storage before the
 * scalar observations leave the browser. */
export async function inspectCollectionFramescaperArchive(page, archive) {
	const script = await mappedBundle('collection-frame-archive.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-collection-frame-archive-fixture.ts'));
	register(page, '/__collection_frame_archive.js', script);
	await page.route('**/__collection_frame_archive.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	const result = await page.evaluate(async bytes => (await import(new URL('/__collection_frame_archive.js', location.href).href))
		.inspectCollectionFramescaperArchiveFixture(bytes), Array.from(archive));
	await assertNativeOpfsWorkerExecution(page); return result;
}

/** Read the retained native queue; this observer neither rewrites intent nor
 * simulates an interruption or destination acknowledgment. */
export async function observeNativePhotoRasterBatchGraphicJournal(page) {
	const script = await mappedBundle('batch-graphic-journal.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-photo-raster-batch-graphic-observer.ts'));
	register(page, '/__batch_graphic_journal.js', script);
	await page.route('**/__batch_graphic_journal.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	return page.evaluate(async () => (await import(new URL('/__batch_graphic_journal.js', location.href).href)).readPhotoRasterBatchGraphicJournalFixture());
}

/** Publish 64 + 16 actual managed originals, then release both native owners. */
export async function seedNativePhotoCullingLibrary(page) {
	const script = await mappedBundle('culling-query-fixture.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-photo-query-native-fixture.ts'));
	register(page, '/__culling_query_fixture.js', script);
	await page.route('**/__culling_query_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	const facts = await page.evaluate(async () => (await import(new URL('/__culling_query_fixture.js', location.href).href)).seedPhotoLibraryQueryNativeV1());
	await assertNativeOpfsWorkerExecution(page); return facts;
}

export async function observeNativePhotoCullingOriginals(page, ids) {
	const facts = await page.evaluate(async ids => (await import(new URL('/__culling_query_fixture.js', location.href).href)).readPhotoLibraryQueryOriginalsNativeV1(ids), ids);
	await assertNativeOpfsWorkerExecution(page); return facts;
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
	const ready = compileNativeImageHandoffScript(name, entry); bundles.set(name, ready); return ready;
}

export async function compileNativeImageHandoffScript(name, entry) {
	const outfile = resolve(repositoryRoot, '.wrangler/lightscaper-native-test-runtime', name);
	const browserShim = createPffftNodeModuleBrowserShim();
	const prelude = resolve(repositoryRoot, 'src/common/editor/macro-script/sandbox-prelude.js');
	const preludeImporter = resolve(repositoryRoot, 'src/common/editor/macro-script/browser-sandbox.ts');
	const assetPrefix = '/__ordinary_frame_still_assets/';
	const preludeUrl = Object.freeze({ kind: 'macro-prelude-url' });
	const result = await build({ entryPoints: [entry], outfile, bundle: true, write: false,
		format: 'esm', platform: 'browser', sourcemap: 'external', loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
		assetNames: '[name]-[hash]', publicPath: assetPrefix,
		plugins: [{ name: 'native-fixture-pffft-node-import', setup(bundle) {
			// Reuse the maintained exact-vendor boundary. Retain its unreachable
			// Node-only import without manufacturing a mapped runtime module.
			bundle.onResolve({ filter: /^module$/ }, args => browserShim.resolveId(args.path, args.importer)
				? { path: args.path, external: true } : undefined);
		} }, { name: 'native-fixture-macro-prelude-url', setup(bundle) {
			// Vite's ?url edge exports an asset URL. Emit the real prelude bytes
			// separately; evaluating the controller must not execute the prelude.
			bundle.onResolve({ filter: /^\.\/sandbox-prelude\.js\?url$/ }, args => args.importer === preludeImporter
				? { path: prelude, pluginData: preludeUrl } : undefined);
			bundle.onLoad({ filter: /\/sandbox-prelude\.js$/ }, async args => args.path === prelude && args.pluginData === preludeUrl
				? { contents: await readFile(prelude), loader: 'file' } : undefined);
		} }] });
	const source = result.outputFiles.find(file => file.path === outfile)?.text;
	const mapText = result.outputFiles.find(file => file.path === `${outfile}.map`)?.text;
	if (typeof source !== 'string' || typeof mapText !== 'string') throw new Error('Expected an actual mapped native test program.');
	const assets = [];
	for (const file of result.outputFiles.filter(file => file.path !== outfile && file.path !== `${outfile}.map`)) {
		if (!/^sandbox-prelude-[A-Z0-9]+\.js$/u.test(basename(file.path)) || assets.length
			|| !Buffer.from(file.contents).equals(await readFile(prelude))) throw new Error('Expected only the unchanged real macro prelude asset.');
		// Untransformed JS offsets already address its real source file. The
		// generated URL export receives no invented prelude source mapping.
		assets.push({ pathname: `${assetPrefix}${basename(file.path)}`, path: prelude, source: file.text });
	}
	return { path: outfile, source, assets, sourceMap: absoluteSourceMapSources(JSON.parse(mapText), dirname(outfile), repositoryRoot) };
}
