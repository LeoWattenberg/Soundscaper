/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sourceMapDirectoryFor } from './build-source-map-relocation.mjs';
import {
	createPlaywrightBrowserServiceWorkerCoverageCollector,
} from './browser-service-worker-coverage.mjs';
import {
	installNavigationCoverageCheckpoints,
	installPageOperationCoverageCheckpoints,
} from './navigation-coverage-checkpoint.mjs';

const BROWSER_WORKER_TARGET_TYPES = Object.freeze([
	'service_worker',
	'shared_storage_worklet',
	'shared_worker',
	'worker',
	'worklet',
]);

// What the browser suite measures is the same `src/` the Node suite measures, so
// it has to arrive in the same shape: a raw V8 profile with a source-map cache
// beside it, exactly as `NODE_V8_COVERAGE` writes one. Chromium hands Playwright
// coverage for the *bundled* chunk it actually ran, addressed by its served URL;
// this turns that into a profile addressed by the chunk's file path, carrying the
// map that leads back to the sources. `scripts/compact-v8-coverage.mjs` then
// merges those files like any other shard, and the coverage job's c8 report
// remaps them onto `src/...` with `--exclude-after-remap`.
//
// An ordinary entry whose map cannot be found is dropped rather than reported.
// A portable E2E profile retains it under the stable executable URL instead, so
// the artifact inventory can own shipped scripts such as `service-worker.js`.
export const BROWSER_COVERAGE_DIRECTORY = 'coverage/v8-browser';
export const PORTABLE_BROWSER_COVERAGE_URL_PREFIX = 'file:///__soundscaper_e2e__/browser/';
export const PORTABLE_REPOSITORY_SOURCE_URL_PREFIX = 'file:///__soundscaper_repo__/';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT_FILE_PATTERN = /\.m?js$/u;

/** Whether this run was asked to record browser coverage. */
export function browserCoverageRequested(environment = process.env) {
	return environment.SCAPE_BROWSER_COVERAGE === '1';
}

/**
 * Whether this browser can be measured, and was asked to be.
 *
 * Only Chromium exposes the V8 precise-coverage protocol Playwright's
 * `page.coverage` speaks, and an ordinary run must behave exactly as it does
 * today, so both conditions have to hold before anything is instrumented.
 *
 * @param {string} browserName
 * @param {Record<string, string | undefined>} [environment]
 * @returns {boolean}
 */
export function collectsBrowserCoverage(browserName, environment = process.env) {
	return browserName === 'chromium' && browserCoverageRequested(environment);
}

/**
 * The line lengths of a script, as Node records them beside a source map.
 *
 * c8 rebuilds a stand-in for the generated source from these, one dot per
 * character, so only the line boundaries have to be right: they are what turns a
 * V8 byte offset into the line and column the map is keyed by.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function sourceLineLengths(text) {
	const lines = String(text).split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	return lines.map((line) => line.length);
}

/**
 * Resolve one served script URL to the built file behind it.
 *
 * @param {string} url the URL Chromium reported the script under
 * @param {Map<string, string>} directoriesByOrigin absolute built directory per origin
 * @returns {{ path: string, directory: string } | null}
 */
export function builtChunkFor(url, directoriesByOrigin) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		// Inline and anonymous scripts have no URL to resolve, and nothing else
		// the page loads belongs to a build this run can map.
		return null;
	}
	const directory = directoriesByOrigin.get(parsed.origin);
	if (directory === undefined) return null;
	const served = decodeURIComponent(parsed.pathname).replace(/^\/+/u, '');
	if (served === '' || !SCRIPT_FILE_PATTERN.test(served)) return null;
	const path = resolve(directory, served);
	if (!path.startsWith(`${directory}${sep}`)) return null;
	return { path, directory };
}

/**
 * The relocated map that belongs to one built chunk.
 *
 * @param {{ path: string, directory: string }} chunk
 * @returns {string}
 */
export function sourceMapPathFor(chunk) {
	return resolve(sourceMapDirectoryFor(chunk.directory), `${basename(chunk.path)}.map`);
}

/**
 * Turn Playwright's coverage entries into one raw V8 profile.
 *
 * @param {Array<{ url: string, scriptId?: string, source?: string, functions?: unknown[] }>} entries
 * @param {(url: string) => { path: string, coverageUrl?: string, sourceMap?: object, source?: string } | null} resolveScript
 * @returns {{ result: object[], 'source-map-cache': Record<string, object> }}
 */
export function browserCoverageProfile(entries, resolveScript) {
	const result = [];
	/** @type {Record<string, object>} */
	const sourceMapCache = Object.create(null);
	for (const entry of entries) {
		const resolved = resolveScript(entry.url);
		if (!resolved) continue;
		const url = resolved.coverageUrl ?? pathToFileURL(resolved.path).href;
		result.push({
			scriptId: String(entry.scriptId ?? result.length),
			url,
			functions: entry.functions ?? [],
		});
		if (resolved.sourceMap === undefined || url in sourceMapCache) continue;
		sourceMapCache[url] = {
			lineLengths: sourceLineLengths(entry.source ?? resolved.source ?? ''),
			data: resolved.sourceMap,
			url: null,
		};
	}
	return { result, 'source-map-cache': sourceMapCache };
}

/**
 * Drop the maps a previous profile from this worker already carried.
 *
 * Every test writes its own profile, and a map for a bundled chunk is megabytes,
 * so repeating it once per test would cost more disk than the coverage is worth.
 * Compaction merges the source-map caches of every profile in the directory, so
 * one copy anywhere in the run is one copy everywhere.
 *
 * @param {{ result: object[], 'source-map-cache': Record<string, object> }} profile
 * @param {Set<string>} alreadyWritten mutated with the maps this profile keeps
 */
export function withoutRepeatedSourceMaps(profile, alreadyWritten) {
	/** @type {Record<string, object>} */
	const sourceMapCache = Object.create(null);
	for (const [url, entry] of Object.entries(profile['source-map-cache'])) {
		if (alreadyWritten.has(url)) continue;
		alreadyWritten.add(url);
		sourceMapCache[url] = entry;
	}
	return { result: profile.result, 'source-map-cache': sourceMapCache };
}

/**
 * The collector one browser test runs behind, or null when the run wants none.
 *
 * @param {{
 *   browserName: string,
 *   environment?: Record<string, string | undefined>,
 *   sites?: Array<{ origin: string, outputDirectory: string }>,
 *   repositoryRoot?: string,
 *   coverageDirectory?: string,
 *   scripts?: Map<string, { path: string, coverageUrl?: string, sourceMap?: object, source?: string } | null>,
 * }} options
 */
export function createBrowserCoverageCollector({
	browserName,
	environment = process.env,
	sites,
	repositoryRoot = REPOSITORY_ROOT,
	coverageDirectory = resolve(repositoryRoot, BROWSER_COVERAGE_DIRECTORY),
	scripts = new Map(),
}) {
	if (!collectsBrowserCoverage(browserName, environment)) return null;

	const configuredDirectory = environment.SCAPE_BROWSER_COVERAGE_DIRECTORY;
	if (configuredDirectory !== undefined) {
		if (!isAbsolute(configuredDirectory)) {
			throw new TypeError('SCAPE_BROWSER_COVERAGE_DIRECTORY must be absolute.');
		}
		coverageDirectory = configuredDirectory;
	}
	const configuredSites = parseCoverageSites(environment.SCAPE_BROWSER_COVERAGE_SITES);
	const directoriesByOrigin = new Map(
		(configuredSites ?? sites ?? []).map((site) => [site.origin, resolve(repositoryRoot, site.outputDirectory)]),
	);
	const portableProductsByOrigin = new Map(
		(configuredSites?.map((site) => [site.origin, site.productId]) ?? []),
	);
	const started = new Set();
	const recorders = new Map();
	const pending = [];
	let workerCollector = null;
	let workerCollectorStart = null;

	function start(page) {
		if (started.has(page) || typeof page.context !== 'function') return;
		started.add(page);
		// The page event fires while Playwright is still building the fixture, so
		// the promise is banked rather than awaited: `settle` is what the test
		// waits on before it navigates, and `collect` before it stops.
		pending.push(startRecording(page).catch((error) => {
			started.delete(page);
			if (!page.isClosed()) throw error;
		}));
	}

	async function startRecording(page) {
		const session = await page.context().newCDPSession(page);
		const recorder = {
			navigationCheckpoints: null,
			pageOperationCheckpoints: null,
			session,
			taken: [],
		};
		recorders.set(page, recorder);
		// Binary block coverage straight from the profiler: `callCount: false`
		// records whether a block ran, not how often, which is all a line and
		// branch report needs and far cheaper than Playwright's counted coverage.
		// The realtime BW64 export spec missed its budget on the runner under the
		// counted kind. A document that navigates away is paused and drained before
		// Chromium clears its old execution context; waiting for the cleared event
		// loses both that page's ranges and any dedicated worker it owned.
		await session.send('Profiler.enable');
		await session.send('Runtime.enable');
		await session.send('Page.enable');
		await session.send('Debugger.enable');
		await session.send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
		recorder.navigationCheckpoints = await installNavigationCoverageCheckpoints({
			checkpoint: (reason) => checkpointRecorder(recorder, reason),
			session,
		});
		recorder.pageOperationCheckpoints = installPageOperationCoverageCheckpoints({
			checkpoint: () => checkpointRecorder(recorder),
			page,
		});
	}

	async function checkpointRecorder(recorder, reason) {
		const [{ result }] = await Promise.all([
			recorder.session.send('Profiler.takePreciseCoverage'),
			workerCollectorStart?.then(() => workerCollector?.checkpoint({
				releaseWorklets: reason === 'audio-context-close',
			})),
		]);
		recorder.taken.push(...result);
	}

	async function resolveScript(url) {
		if (scripts.has(url)) return scripts.get(url) ?? null;
		const chunk = builtChunkFor(url, directoriesByOrigin);
		const origin = originOf(url);
		const productId = origin === null ? undefined : portableProductsByOrigin.get(origin);
		const resolved = chunk === null ? null : await readSourceMap(chunk, {
			repositoryRoot,
			productId,
		});
		scripts.set(url, resolved);
		return resolved;
	}

	async function settle() {
		while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
	}

	return {
		/** Start coverage on every page this context has or will open. */
		attach(context) {
			if (workerCollectorStart !== null) throw new Error('Browser coverage was already attached.');
			workerCollectorStart = createPlaywrightBrowserServiceWorkerCoverageCollector({
				browser: context.browser?.(),
				keepUrl: (url) => directoriesByOrigin.has(originOf(url)),
				targetTypes: BROWSER_WORKER_TARGET_TYPES,
			}).then(async (collector) => {
				workerCollector = collector;
				await collector.start();
			});
			pending.push(workerCollectorStart);
			for (const page of context.pages()) start(page);
			context.on('page', start);
		},
		/** Wait for every started page to actually be recording. */
		settle,
		/**
		 * Stop every page, and write what they recorded.
		 *
		 * @param {string} label a readable stem for the profile's file name
		 * @param {Set<string>} alreadyWritten maps this worker has already written
		 * @returns {Promise<string | null>} the profile written, if any
		 */
		async collect(label, alreadyWritten) {
			await settle();
			const entries = [];
			for (const page of started) {
				const recorder = recorders.get(page);
				recorders.delete(page);
				if (!recorder) continue;
				await recorder.navigationCheckpoints?.settle();
				recorder.pageOperationCheckpoints?.dispose();
				entries.push(...recorder.taken);
				const pageClosed = page.isClosed();
				if (pageClosed) continue;
				try {
					entries.push(...await stopRecording(recorder.session, recorder.navigationCheckpoints));
				} catch (error) {
					// A page the test closed on its way out has nothing left to
					// report; anything else is a real failure to record.
					if (!page.isClosed()) throw error;
				}
			}
			if (workerCollector !== null) {
				entries.push(...(await workerCollector.collect()).entries);
			}
			started.clear();

			for (const entry of entries) {
				const resolved = await resolveScript(entry.url);
				if (resolved !== null && resolved.source === undefined && typeof entry.source !== 'string') {
					resolved.source = await readFile(resolved.path, 'utf8');
				}
			}
			const profile = browserCoverageProfile(entries, (url) => scripts.get(url) ?? null);
			if (profile.result.length === 0) return null;

			const file = resolve(coverageDirectory, `${profileFileStem(label)}-${randomUUID()}.json`);
			await mkdir(coverageDirectory, { recursive: true });
			await writeFile(file, JSON.stringify(withoutRepeatedSourceMaps(profile, alreadyWritten)));
			return file;
		},
	};
}

function parseCoverageSites(serialized) {
	if (serialized === undefined) return null;
	let sites;
	try { sites = JSON.parse(serialized); }
	catch (error) {
		throw new TypeError('SCAPE_BROWSER_COVERAGE_SITES must be valid JSON.', { cause: error });
	}
	if (!Array.isArray(sites) || sites.length === 0) {
		throw new TypeError('SCAPE_BROWSER_COVERAGE_SITES must name at least one site.');
	}
	const origins = new Set();
	for (const site of sites) {
		if (!site || typeof site !== 'object' || Array.isArray(site)
			|| typeof site.productId !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(site.productId)
			|| typeof site.origin !== 'string' || new URL(site.origin).origin !== site.origin
			|| typeof site.outputDirectory !== 'string' || !isAbsolute(site.outputDirectory)) {
			throw new TypeError('SCAPE_BROWSER_COVERAGE_SITES contains an invalid site.');
		}
		if (origins.has(site.origin)) {
			throw new TypeError('SCAPE_BROWSER_COVERAGE_SITES contains a duplicate origin.');
		}
		origins.add(site.origin);
	}
	return sites;
}

async function stopRecording(session, navigationCheckpoints) {
	const { result } = await session.send('Profiler.takePreciseCoverage');
	await navigationCheckpoints?.dispose();
	await session.send('Profiler.stopPreciseCoverage');
	await session.send('Profiler.disable');
	await session.send('Debugger.disable');
	await session.detach();
	return result;
}

async function readSourceMap(chunk, { repositoryRoot, productId }) {
	let text;
	try {
		text = await readFile(sourceMapPathFor(chunk), 'utf8');
	} catch {
		// A build made without SCAPE_BUILD_SOURCE_MAPS=1 has no maps at all, and a
		// script served from outside the build has none either. Neither is an
		// error. Ordinary coverage drops it; portable E2E coverage retains the
		// executable itself so its inventory can still require an exact hit.
		return productId === undefined ? null : {
			path: chunk.path,
			coverageUrl: portableCoverageUrl(chunk, productId),
		};
	}
	const sourceMap = productId === undefined
		? JSON.parse(text)
		: await portableSourceMap(JSON.parse(text), repositoryRoot);
	return {
		path: chunk.path,
		...(productId === undefined ? {} : { coverageUrl: portableCoverageUrl(chunk, productId) }),
		sourceMap,
	};
}

async function portableSourceMap(map, repositoryRoot) {
	if (!Array.isArray(map.sources)) return map;
	const sourcesContent = [];
	const sources = [];
	for (const source of map.sources) {
		const repositoryPath = repositorySourcePath(source);
		if (repositoryPath === null) {
			sources.push(source);
			sourcesContent.push(null);
			continue;
		}
		sources.push(`${PORTABLE_REPOSITORY_SOURCE_URL_PREFIX}${repositoryPath}`);
		sourcesContent.push(await readFile(resolve(repositoryRoot, repositoryPath), 'utf8'));
	}
	return { ...map, sourceRoot: '', sources, sourcesContent };
}

function repositorySourcePath(source) {
	if (typeof source !== 'string') return null;
	let pathname;
	try { pathname = decodeURIComponent(new URL(source).pathname).replaceAll('\\', '/'); }
	catch { return null; }
	if (pathname.includes('/node_modules/') || pathname.includes('/vendor/')) return null;
	for (const root of ['src', 'desktop']) {
		const marker = `/${root}/`;
		const at = pathname.lastIndexOf(marker);
		if (at >= 0) return pathname.slice(at + 1);
	}
	return null;
}

function portableCoverageUrl(chunk, productId) {
	const served = relative(chunk.directory, chunk.path).split(sep).map(encodeURIComponent).join('/');
	return `${PORTABLE_BROWSER_COVERAGE_URL_PREFIX}${productId}/${served}`;
}

function originOf(url) {
	try { return new URL(url).origin; } catch { return null; }
}

function profileFileStem(label) {
	const stem = String(label).replaceAll(/[^A-Za-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
	return stem === '' ? 'browser' : stem.toLowerCase();
}
