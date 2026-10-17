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
const crashCollections = new WeakMap();

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

/** Qualify the selected Session with real storage acknowledgments. The helper
 * joins its held work and closes every owner before returning scalar facts. */
export async function qualifyNativePhotoPreviewSessionClose(page, cut) {
	const script = await mappedBundle('preview-session-close.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-preview-session-close-native-v1.ts'));
	register(page, '/__photo_preview_session_close.js', script);
	await page.route('**/__photo_preview_session_close.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	const facts = await page.evaluate(async cut => (await import(new URL('/__photo_preview_session_close.js', location.href).href))
		.qualifyPhotoPreviewSessionCloseNativeV1(cut), cut);
	await assertNativeOpfsWorkerExecution(page); return facts;
}

/** Qualify the genuinely restored allocation; the native worker checkpoint
 * authenticates donor import, while preview publication uses IndexedDB. */
export async function qualifyNativePhotoRestoredPreviewSessionClose(page, cut) {
	const script = await mappedBundle('restored-preview-session-close.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-restored-preview-session-close-native-v1.ts'));
	register(page, '/__restored_preview_session_close_native.js', script);
	await page.route('**/__restored_preview_session_close_native.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	const facts = await page.evaluate(async cut => (await import(new URL('/__restored_preview_session_close_native.js', location.href).href))
		.qualifyPhotoRestoredPreviewSessionCloseNativeV1(cut), cut);
	await assertNativeOpfsWorkerExecution(page); return facts;
}

/** Observe genuine restored import transactions, then join Close and recovery. */
export async function qualifyNativePhotoRestoredImportSessionClose(page, cut) {
	const script = await mappedBundle('restored-import-session-close.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-restored-import-session-close-native-v1.ts'));
	register(page, '/__restored_import_session_close_native.js', script);
	await page.route('**/__restored_import_session_close_native.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	const facts = await page.evaluate(async cut => (await import(new URL('/__restored_import_session_close_native.js', location.href).href))
		.qualifyPhotoRestoredImportSessionCloseNativeV1(cut), cut);
	await assertNativeOpfsWorkerExecution(page); return facts;
}

/** Observe default-library import through its actual native OPFS worker. */
export async function qualifyNativePhotoDefaultImportSessionClose(page, cut) {
	const script = await mappedBundle('default-import-session-close.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-default-import-session-close-native-v1.ts'));
	register(page, '/__default_import_session_close.js', script);
	await page.route('**/__default_import_session_close.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	const facts = await page.evaluate(async cut => (await import(new URL('/__default_import_session_close.js', location.href).href))
		.qualifyPhotoDefaultImportSessionCloseNativeV1(cut), cut);
	await assertNativeOpfsWorkerExecution(page); return facts;
}

/** A persistent profile is supplied by the process-crash spec itself. Install
 * the unchanged native worker and mapped test program before any startup work. */
export async function installNativePhotoOriginalProcessCrashRuntime(page) {
	if (!scriptsByContext.has(page.context())) scriptsByContext.set(page.context(), {
		scripts: new Map(), origin: browserOriginForOriginalProcessCrash(),
	});
	const browserName = page.context().browser()?.browserType().name();
	if (!collectors.has(page.context()) && collectsBrowserCoverage(browserName)) {
		const captured = scriptsByContext.get(page.context());
		const origins = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS) : {};
		const sites = ordinaryBrowserProductSitePlan().sites.map(site => ({ ...site, origin: origins[site.productId] ?? site.origin }));
		const collector = createBrowserCoverageCollector({ browserName, scripts: captured.scripts, sites });
		collectors.set(page.context(), collector); collector.attach(page.context());
		await collector.settle();
	}
	await installNativeImageHandoffRuntime(page);
	const script = await mappedBundle('original-process-crash.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-original-process-crash-native-v1.ts'));
	const pathname = '/__original_process_crash_native.js';
	register(page, pathname, script);
	await page.route(`**${pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	return pathname;
}

/** Collect the still-live process before a crash, and each reopened owner
 * before its graceful close. The crash profile does not use the base context. */
export async function collectNativePhotoOriginalProcessCrashCoverage(page, label) {
	const context = page.context(), prior = crashCollections.get(context);
	if (prior) { await prior; return; }
	const collector = collectors.get(context); if (!collector) return;
	const ready = collector.collect(label, writtenSourceMaps); crashCollections.set(context, ready);
	await ready;
}

function browserOriginForOriginalProcessCrash() {
	const origins = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS) : {};
	return origins.lightscaper ?? ordinaryBrowserProductSitePlan().sites.find(site => site.productId === 'lightscaper').origin;
}

/** Full canvas comparison happens after the measured current-ready paint. */
export async function validateNativePhotoDevelopProxyCanvas(page, selector, stage) {
	const script = await mappedBundle('develop-proxy-reference.js', resolve(repositoryRoot, 'tests/browser/helpers/lightscaper-develop-proxy-reference.ts'));
	register(page, '/__develop_proxy_reference.js', script);
	await page.route('**/__develop_proxy_reference.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	return page.evaluate(async ({ selector, stage }) => {
		const canvas = document.querySelector(selector);
		if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Actual Develop canvas missing.');
		return (await import(new URL('/__develop_proxy_reference.js', location.href).href)).validateDevelopProxyCanvasV1(canvas, stage);
	}, { selector, stage });
}

/** Authenticate actual selected originals without transferring large pixel planes. */
export async function observeNativePhotoDevelopProxyCustody(page, photoId) {
	const script = await mappedBundle('develop-proxy-custody.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-develop-proxy-native-observer.ts'));
	register(page, '/__develop_proxy_custody.js', script);
	await page.route('**/__develop_proxy_custody.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	const facts = await page.evaluate(async photoId => (await import(new URL('/__develop_proxy_custody.js', location.href).href))
		.readPhotoDevelopProxyCustodyNativeV1(photoId, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
	await assertNativeOpfsWorkerExecution(page); return facts;
}

/** Compare the existing full-resolution presentation without transferring it. */
export async function validateNativePhotoDevelopFullResolutionCanvas(page, selector, stage) {
	const script = await mappedBundle('develop-full-resolution-reference.js', resolve(repositoryRoot, 'tests/browser/helpers/lightscaper-develop-full-resolution-reference.ts'));
	register(page, '/__develop_full_resolution_reference.js', script);
	await page.route('**/__develop_full_resolution_reference.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	return page.evaluate(async ({ selector, stage }) => {
		const canvas = document.querySelector(selector);
		if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Actual full-resolution Develop canvas missing.');
		return (await import(new URL('/__develop_full_resolution_reference.js', location.href).href)).validateDevelopFullResolutionCanvasV1(canvas, stage);
	}, { selector, stage });
}

export function inspectNativePhotoDevelopFullResolutionPng(page, bytes, stage) {
	return inspectDevelopFullResolutionDownload(page, bytes, stage, 'inspectDevelopFullResolutionPngNativeV1', 'image/png', 64 * 1024 * 1024);
}

export function inspectNativePhotoDevelopFullResolutionFramescaper(page, bytes, stage) {
	return inspectDevelopFullResolutionDownload(page, bytes, stage, 'inspectDevelopFullResolutionFramescaperNativeV1', 'application/zip', 256 * 1024 * 1024);
}

/** Serve the actual downloaded binary body; only scalar readback leaves the page. */
async function inspectDevelopFullResolutionDownload(page, bytes, stage, method, contentType, maximumBytes) {
	if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength > maximumBytes) throw new RangeError('Downloaded binary body exceeds its native fixture bound.');
	const script = await mappedBundle('develop-full-resolution-native.js', resolve(repositoryRoot, 'tests/helpers/lightscaper-develop-full-resolution-native.ts'));
	register(page, '/__develop_full_resolution_native.js', script);
	await page.route('**/__develop_full_resolution_native.js', route => route.fulfill({ contentType: 'text/javascript', body: script.source }));
	for (const asset of script.assets) {
		register(page, asset.pathname, asset);
		await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
	}
	const pathname = `/__develop_full_resolution_download_${crypto.randomUUID()}`, pattern = `**${pathname}`, serving = [];
	const handler = route => {
		const work = route.fulfill({ contentType, body: bytes });
		serving.push(work.then(() => ({ failed: false }), error => ({ failed: true, error }))); return work;
	};
	await page.route(pattern, handler);
	let result, failed = false, primary;
	try {
		result = await page.evaluate(async ({ pathname, stage, method }) => {
			const response = await fetch(new URL(pathname, location.href), { cache: 'no-store' });
			if (!response.ok) throw new Error('Actual downloaded binary body is unavailable.');
			const runtime = await import(new URL('/__develop_full_resolution_native.js', location.href).href);
			return runtime[method]({ body: await response.blob(), stage }, { beforeClose: () => globalThis.__assertNativeOpfsWorkerExecution() });
		}, { pathname, stage, method });
		if (serving.length !== 1) throw new Error('Expected one actual downloaded-body request.');
		await assertNativeOpfsWorkerExecution(page);
	} catch (error) { failed = true; primary = error; }
	const cleanup = [];
	try { await page.unroute(pattern, handler); } catch (error) { cleanup.push(error); }
	for (const settled of await Promise.allSettled(serving)) {
		if (settled.status === 'rejected') cleanup.push(settled.reason);
		else if (settled.value.failed) cleanup.push(settled.value.error);
	}
	if (failed) {
		const failures = [primary, ...cleanup.filter(error => !Object.is(error, primary))];
		if (failures.length > 1) throw new AggregateError(failures, 'Downloaded native inspection and cleanup failed.', { cause: primary });
		throw primary;
	}
	if (cleanup.length) throw new AggregateError(cleanup, 'Downloaded native inspection cleanup failed.');
	return result;
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
