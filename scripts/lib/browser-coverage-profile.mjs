/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sourceMapDirectoryFor } from './build-source-map-relocation.mjs';

// What the browser suite measures is the same `src/` the Node suite measures, so
// it has to arrive in the same shape: a raw V8 profile with a source-map cache
// beside it, exactly as `NODE_V8_COVERAGE` writes one. Chromium hands Playwright
// coverage for the *bundled* chunk it actually ran, addressed by its served URL;
// this turns that into a profile addressed by the chunk's file path, carrying the
// map that leads back to the sources. `scripts/compact-v8-coverage.mjs` then
// merges those files like any other shard, and the coverage job's c8 report
// remaps them onto `src/...` with `--exclude-after-remap`.
//
// An entry whose map cannot be found is dropped rather than reported: without a
// map c8 would report the built chunk itself, which is not a file any coverage
// scope owns, and the gate fails on production files it cannot classify.
export const BROWSER_COVERAGE_DIRECTORY = 'coverage/v8-browser';

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
 * @param {(url: string) => { path: string, sourceMap: object, source?: string } | null} resolveScript
 * @returns {{ result: object[], 'source-map-cache': Record<string, object> }}
 */
export function browserCoverageProfile(entries, resolveScript) {
	const result = [];
	/** @type {Record<string, object>} */
	const sourceMapCache = Object.create(null);
	for (const entry of entries) {
		const resolved = resolveScript(entry.url);
		if (!resolved) continue;
		const url = pathToFileURL(resolved.path).href;
		result.push({
			scriptId: String(entry.scriptId ?? result.length),
			url,
			functions: entry.functions ?? [],
		});
		if (url in sourceMapCache) continue;
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
 *   scripts?: Map<string, { path: string, sourceMap: object, source?: string } | null>,
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

	const directoriesByOrigin = new Map(
		(sites ?? []).map((site) => [site.origin, resolve(repositoryRoot, site.outputDirectory)]),
	);
	const started = new Set();
	const recorders = new Map();
	const pending = [];

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
		const recorder = { session, taken: [] };
		recorders.set(page, recorder);
		// Binary block coverage straight from the profiler: `callCount: false`
		// records whether a block ran, not how often, which is all a line and
		// branch report needs and far cheaper than Playwright's counted coverage.
		// The realtime BW64 export spec missed its budget on the runner under the
		// counted kind. Coverage of a document that navigates away is taken as its
		// contexts clear, the way Playwright keeps coverage across navigations.
		await session.send('Profiler.enable');
		await session.send('Runtime.enable');
		session.on('Runtime.executionContextsCleared', () => {
			pending.push(session.send('Profiler.takePreciseCoverage')
				.then(({ result }) => { recorder.taken.push(...result); })
				.catch(() => {}));
		});
		await session.send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
	}

	async function resolveScript(url) {
		if (scripts.has(url)) return scripts.get(url) ?? null;
		const chunk = builtChunkFor(url, directoriesByOrigin);
		const resolved = chunk === null ? null : await readSourceMap(chunk);
		scripts.set(url, resolved);
		return resolved;
	}

	async function settle() {
		await Promise.all(pending.splice(0, pending.length));
	}

	return {
		/** Start coverage on every page this context has or will open. */
		attach(context) {
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
				entries.push(...recorder.taken);
				if (page.isClosed()) continue;
				try {
					entries.push(...await stopRecording(recorder.session));
				} catch (error) {
					// A page the test closed on its way out has nothing left to
					// report; anything else is a real failure to record.
					if (!page.isClosed()) throw error;
				}
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

async function stopRecording(session) {
	const { result } = await session.send('Profiler.takePreciseCoverage');
	await session.send('Profiler.stopPreciseCoverage');
	await session.send('Profiler.disable');
	await session.detach();
	return result;
}

async function readSourceMap(chunk) {
	let text;
	try {
		text = await readFile(sourceMapPathFor(chunk), 'utf8');
	} catch {
		// A build made without SCAPE_BUILD_SOURCE_MAPS=1 has no maps at all, and a
		// script served from outside the build has none either. Neither is an
		// error: it only means this script contributes no coverage.
		return null;
	}
	return { path: chunk.path, sourceMap: JSON.parse(text) };
}

function profileFileStem(label) {
	const stem = String(label).replaceAll(/[^A-Za-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
	return stem === '' ? 'browser' : stem.toLowerCase();
}
