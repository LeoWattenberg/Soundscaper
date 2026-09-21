/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix, win32 } from 'node:path';

import {
	createPlaywrightBrowserServiceWorkerCoverageCollector,
	INSTALL_WORKLET_COVERAGE_CHECKPOINT,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from '../../../scripts/lib/browser-service-worker-coverage.mjs';
import {
	INSTALL_NAVIGATION_COVERAGE_CHECKPOINT,
	NAVIGATION_COVERAGE_CHECKPOINT_URL,
} from '../../../scripts/lib/navigation-coverage-checkpoint.mjs';
import { startPackagedRuntimeTargetCoverage } from './packaged-runtime-target-coverage.js';

const COVERAGE_SUBDIRECTORY = 'coverage/v8-packaged';
const PRODUCT_IDS = new Set(['soundscaper', 'framescaper']);
const PLATFORMS = new Set(['linux', 'win32', 'darwin']);
const ARCHITECTURES = new Set(['x64', 'arm64']);
const START_TIMEOUT_MS = 30_000;

/** Resolve Electron's installed app.asar from its platform executable. */
export function resolvePackagedAppAsarPath(executablePath, platform) {
	if (!PLATFORMS.has(platform)) throw new TypeError('Packaged app.asar platform is invalid.');
	const paths = platform === 'win32' ? win32 : posix;
	if (typeof executablePath !== 'string' || !paths.isAbsolute(executablePath)) {
		throw new TypeError('Packaged app.asar executable path must be absolute.');
	}
	const executableDirectory = paths.dirname(executablePath);
	return platform === 'darwin'
		? paths.resolve(executableDirectory, '..', 'Resources', 'app.asar')
		: paths.resolve(executableDirectory, 'resources', 'app.asar');
}

/** Hash the installed archive before its Electron process can execute it. */
export async function capturePackagedAppAsarBeforeLaunch({ executablePath, platform }) {
	const path = resolvePackagedAppAsarPath(executablePath, platform);
	return Object.freeze({
		path,
		beforeLaunch: await packagedAppAsarFileIdentity(path),
	});
}

/** Re-hash an installed archive and reject any launch-to-collection mutation. */
export async function capturePackagedAppAsarAfterCollection(beforeLaunch) {
	const inspected = inspectedPackagedAppAsarBeforeLaunch(beforeLaunch);
	const afterCollection = await packagedAppAsarFileIdentity(inspected.path);
	if (!sameFileIdentity(inspected.beforeLaunch, afterCollection)) {
		throw new Error('Packaged coverage app.asar changed between launch and collection.');
	}
	return Object.freeze({
		path: inspected.path,
		beforeLaunch: inspected.beforeLaunch,
		afterCollection,
	});
}

/**
 * Build the environment for the inner product process without leaking the
 * outer Electron-as-Node or Node coverage settings into an ordinary launch.
 */
export function packagedRuntimeCoverageLaunch(environment = process.env) {
	const childEnvironment = { ...environment };
	delete childEnvironment.ELECTRON_RUN_AS_NODE;
	delete childEnvironment.NODE_V8_COVERAGE;
	if (environment.SCAPE_BROWSER_COVERAGE !== '1') {
		return Object.freeze({ coverageDirectory: null, environment: Object.freeze(childEnvironment) });
	}
	const runRoot = environment.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT;
	if (typeof runRoot !== 'string' || !isAbsolute(runRoot)) {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT must be absolute when packaged coverage is enabled.');
	}
	const coverageDirectory = join(runRoot, COVERAGE_SUBDIRECTORY);
	childEnvironment.NODE_V8_COVERAGE = coverageDirectory;
	return Object.freeze({
		coverageDirectory,
		environment: Object.freeze(childEnvironment),
	});
}

/**
 * Record renderer, preload, and recursively attached child-target execution
 * from the packaged Chromium targets.
 */
export function createPackagedRuntimeCoverageCollector(options) {
	const metadata = coverageMetadata(options);
	const appAsarBeforeLaunch = inspectedPackagedAppAsarBeforeLaunch(
		options.appAsar,
		resolvePackagedAppAsarPath(options.executablePath, options.platform),
	);
	const coverageDirectory = absoluteDirectory(options.coverageDirectory);
	const context = options.context;
	if (!context || typeof context.pages !== 'function' || typeof context.newCDPSession !== 'function') {
		throw new TypeError('Packaged coverage requires a Chromium browser context.');
	}
	const browser = options.browser ?? context.browser?.();
	if (!browser) throw new TypeError('Packaged coverage requires its Chromium browser.');
	const recorders = new Map();
	const startedPages = new Set();
	const pending = [];
	let attached = false;
	let collected = false;
	let serviceWorkerCollector = null;

	function keepUrl(url) {
		if (typeof url !== 'string' || url === '') return false;
		if (url.startsWith(`${metadata.appOrigin}/`)) return true;
		if (url.startsWith(`${metadata.baseOrigin}/`)) return true;
		try {
			if (/^[a-z][a-z\d+.-]*:/iu.test(url) && !/^[A-Za-z]:[\\/]/u.test(url)) {
				const parsed = new URL(url);
				if (parsed.protocol === 'chrome-extension:' || parsed.protocol === 'devtools:') return false;
				if (!['file:', 'http:', 'https:'].includes(parsed.protocol)) return true;
			}
			const path = decodeURIComponent(url.startsWith('file:') ? new URL(url).pathname : url)
				.replaceAll('\\', '/');
			if (!url.startsWith('file:') && !path.startsWith('/') && !/^[A-Za-z]:\//u.test(path)) return false;
			return /(?:^|\/)[^/]*preload\.(?:c|m)?js$/u.test(path);
		} catch {
			return false;
		}
	}

	function attachPage(page) {
		if (startedPages.has(page) || page.isClosed?.() === true) return;
		startedPages.add(page);
		const ready = startRecorder(context, page, keepUrl, pending).then((recorder) => {
			recorders.set(page, recorder);
		}).catch((error) => {
			startedPages.delete(page);
			throw error;
		});
		pending.push(ready);
	}

	const onPage = (page) => { attachPage(page); };

	async function settle() {
		while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
	}

	return Object.freeze({
		async start() {
			if (attached) throw new Error('Packaged runtime coverage was already started.');
			attached = true;
			serviceWorkerCollector = await createPlaywrightBrowserServiceWorkerCoverageCollector({
				browser,
				keepUrl,
			});
			await serviceWorkerCollector.start();
			const page = await waitForProductPage(context, metadata.appOrigin);
			attachPage(page);
			await settle();
			context.on('page', onPage);
			for (const candidate of context.pages()) attachPage(candidate);
			await settle();
			for (const [candidate, recorder] of recorders) {
				if (candidate.isClosed?.() !== true) await recorder.reload(START_TIMEOUT_MS);
			}
			await settle();
		},
		async checkpoint() {
			if (!attached || collected) return;
			await settle();
			await serviceWorkerCollector?.checkpoint();
			await Promise.all([...recorders.values()].map((recorder) => recorder.checkpoint()));
			await settle();
		},
		async collect() {
			if (!attached) throw new Error('Packaged runtime coverage has not started.');
			if (collected) throw new Error('Packaged runtime coverage was already collected.');
			collected = true;
			context.off?.('page', onPage);
			await settle();
			const entries = [];
			const pausedTargetCounts = Object.create(null);
			const sources = Object.create(null);
			const targetCounts = Object.create(null);
			const targetTypes = new Set();
			const captures = [];
			if (serviceWorkerCollector !== null) captures.push(await serviceWorkerCollector.collect());
			for (const recorder of recorders.values()) {
				captures.push(await recorder.collect());
			}
			for (const capture of captures) {
				entries.push(...capture.entries);
				await settle();
				for (const [url, source] of capture.sources) {
					if (url in sources && sources[url] !== source) {
						throw new Error(`Packaged coverage captured conflicting source bytes for ${url}.`);
					}
					sources[url] = source;
				}
				for (const type of capture.targetTypes) targetTypes.add(type);
				for (const [type, count] of Object.entries(capture.targetCounts)) {
					targetCounts[type] = (targetCounts[type] ?? 0) + count;
				}
				for (const [type, count] of Object.entries(capture.pausedTargetCounts)) {
					pausedTargetCounts[type] = (pausedTargetCounts[type] ?? 0) + count;
				}
			}
			const excludedInstrumentation = new Set();
			for (const [url, source] of Object.entries(sources)) {
				if (!url.startsWith('soundscaper-coverage:')) continue;
				authenticateCoverageInstrumentation(url, source);
				excludedInstrumentation.add(url);
				delete sources[url];
			}
			const result = entries.filter((entry) => {
				if (!entry.url.startsWith('soundscaper-coverage:')) return keepUrl(entry.url);
				if (!excludedInstrumentation.has(entry.url)) {
					throw new Error(`Packaged coverage captured no instrumentation source for ${entry.url}.`);
				}
				return false;
			});
			if (result.length === 0) throw new Error('Packaged runtime coverage recorded no first-party scripts.');
			const appAsar = await capturePackagedAppAsarAfterCollection(appAsarBeforeLaunch);
			const profile = {
				result,
				'script-source-cache': sources,
				'soundscaper-packaged-runtime': {
					...metadata,
					appAsar,
					childTargetStrategy: 'recursive-auto-attach-paused',
					capturesChildTargets: true,
					pausedTargetCounts,
					targetCounts,
					targetTypes: [...targetTypes].sort(),
				},
				'source-map-cache': Object.create(null),
			};
			await mkdir(coverageDirectory, { recursive: true });
			const file = join(coverageDirectory, `packaged-${metadata.productId}-${randomUUID()}.json`);
			const temporary = `${file}.tmp`;
			await writeFile(temporary, JSON.stringify(profile));
			await rename(temporary, file);
			return file;
		},
	});
}

function authenticateCoverageInstrumentation(url, source) {
	const expected = new Map([
		[NAVIGATION_COVERAGE_CHECKPOINT_URL, INSTALL_NAVIGATION_COVERAGE_CHECKPOINT],
		[WORKLET_COVERAGE_CHECKPOINT_URL, INSTALL_WORKLET_COVERAGE_CHECKPOINT],
	]).get(url);
	if (expected === undefined || source !== expected) {
		throw new Error(`Packaged coverage captured unapproved instrumentation source ${url}.`);
	}
}

async function startRecorder(context, page, keepUrl, pending) {
	const session = await context.newCDPSession(page);
	return startPackagedRuntimeTargetCoverage({ keepUrl, page, pending, rootSession: session });
}

async function waitForProductPage(context, appOrigin) {
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const page = context.pages().find((candidate) => candidate.url().startsWith(`${appOrigin}/`));
		if (page) {
			try {
				await page.waitForFunction(
					() => document.querySelector('[data-audio-editor]')?.getAttribute('data-audio-editor-bound') === 'true',
					undefined,
					{ timeout: Math.max(1, deadline - Date.now()) },
				);
				return page;
			} catch {
				// Electron may replace its initial webContents while the product settles.
			}
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Packaged runtime did not expose its ${appOrigin} product page for coverage.`);
}

function coverageMetadata(options) {
	const productId = options.productId;
	const platform = options.platform;
	const architecture = options.architecture;
	if (!PRODUCT_IDS.has(productId)) throw new TypeError('Packaged coverage product ID is invalid.');
	if (!PLATFORMS.has(platform)) throw new TypeError('Packaged coverage platform is invalid.');
	if (!ARCHITECTURES.has(architecture)) throw new TypeError('Packaged coverage architecture is invalid.');
	if (typeof options.executablePath !== 'string' || !isAbsolute(options.executablePath)) {
		throw new TypeError('Packaged coverage executable path must be absolute.');
	}
	if (options.processId !== undefined && (!Number.isSafeInteger(options.processId) || options.processId <= 0)) {
		throw new TypeError('Packaged coverage process ID must be a positive integer.');
	}
	let baseOrigin;
	try { baseOrigin = new URL(options.baseURL).origin; } catch { throw new TypeError('Packaged coverage base URL is invalid.'); }
	if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseOrigin)) {
		throw new TypeError('Packaged coverage base URL must be a loopback HTTP origin.');
	}
	return Object.freeze({
		appOrigin: `${productId}-app://bundle`,
		architecture,
		baseOrigin,
		captureKind: 'cdp-precise-coverage',
		executablePath: options.executablePath,
		platform,
		...(options.processId === undefined ? {} : { processId: options.processId }),
		productId,
		schemaVersion: 2,
	});
}

function inspectedPackagedAppAsarBeforeLaunch(value, expectedPath = null) {
	if (!value || typeof value !== 'object' || typeof value.path !== 'string' || !isAbsolute(value.path)
		|| (expectedPath !== null && value.path !== expectedPath)) {
		throw new TypeError('Packaged coverage requires the pre-launch app.asar path.');
	}
	const beforeLaunch = value.beforeLaunch;
	if (!beforeLaunch || typeof beforeLaunch !== 'object'
		|| !Number.isSafeInteger(beforeLaunch.byteLength) || beforeLaunch.byteLength < 0
		|| typeof beforeLaunch.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(beforeLaunch.sha256)) {
		throw new TypeError('Packaged coverage requires a valid pre-launch app.asar identity.');
	}
	return Object.freeze({
		path: value.path,
		beforeLaunch: Object.freeze({
			byteLength: beforeLaunch.byteLength,
			sha256: beforeLaunch.sha256,
		}),
	});
}

async function packagedAppAsarFileIdentity(path) {
	let byteLength = 0;
	const hash = createHash('sha256');
	try {
		for await (const chunk of createReadStream(path)) {
			byteLength += chunk.byteLength;
			hash.update(chunk);
		}
	} catch (cause) {
		throw new Error(`Packaged coverage could not hash app.asar at ${path}.`, { cause });
	}
	if (!Number.isSafeInteger(byteLength)) {
		throw new Error('Packaged coverage app.asar is too large to identify safely.');
	}
	return Object.freeze({ byteLength, sha256: hash.digest('hex') });
}

function sameFileIdentity(left, right) {
	return left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function absoluteDirectory(value) {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError('Packaged coverage directory must be absolute.');
	}
	return value;
}
