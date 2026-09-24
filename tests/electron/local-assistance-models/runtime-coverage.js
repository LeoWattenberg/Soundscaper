/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID as createRandomUUID } from 'node:crypto';
import { once } from 'node:events';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolvePackagedProductExecutable } from '../../../scripts/lib/desktop-packaged-product-executable.mjs';
import {
	INSTALL_WORKLET_COVERAGE_CHECKPOINT,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from '../../../scripts/lib/browser-service-worker-coverage.mjs';
import {
	INSTALL_NAVIGATION_COVERAGE_CHECKPOINT,
	NAVIGATION_COVERAGE_CHECKPOINT_URL,
} from '../../../scripts/lib/navigation-coverage-checkpoint.mjs';
import {
	capturePackagedExecutableResourcesAfterCollection,
	capturePackagedExecutableResourcesBeforeLaunch,
} from '../../../scripts/lib/packaged-executable-resource-identity.mjs';
import { createPackagedWebAssemblyAuthenticator } from '../../../scripts/lib/packaged-webassembly-coverage.mjs';
import { startPackagedRuntimeTargetCoverage } from '../../browser/helpers/packaged-runtime-target-coverage.js';

const KIND = 'soundscaper-local-assistance-runtime';
const CAPTURE_KIND = 'local-assistance-cdp-precise-coverage';
const SESSION_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u;
const NODE_PROFILE_PATTERN = /^coverage-(\d+)-(\d+)-(\d+)\.json$/u;
const PRODUCTS = new Set(['framescaper', 'soundscaper']);
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const ARCHITECTURES = new Set(['arm64', 'x64']);
const CDP_FILE = 'cdp.json';
const SESSION_FILE = 'session.json';
const RELOAD_TIMEOUT_MS = 30_000;
const COVERAGE_INSTRUMENTATION = new Map([
	[NAVIGATION_COVERAGE_CHECKPOINT_URL, INSTALL_NAVIGATION_COVERAGE_CHECKPOINT],
	[WORKLET_COVERAGE_CHECKPOINT_URL, INSTALL_WORKLET_COVERAGE_CHECKPOINT],
]);

/** Prepare immutable product identities and a private Node coverage directory before spawn. */
export async function prepareLocalAssistanceRuntimeCoverage(options, dependencies = {}) {
	const configuration = validateOptions(options);
	const fileSystem = dependencies.fileSystem ?? await rawFileSystem();
	const randomUUID = dependencies.randomUUID ?? createRandomUUID;
	const startTargetCoverage = dependencies.startTargetCoverage ?? startPackagedRuntimeTargetCoverage;
	const sessionId = randomUUID();
	if (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId)) {
		throw new Error('Local-assistance coverage requires a canonical UUID v4 session identity.');
	}
	const coverageRoot = join(configuration.runRoot, 'coverage/v8-local-assistance');
	const sessionDirectory = join(coverageRoot, sessionId);
	await mkdir(coverageRoot, { recursive: true });
	await mkdir(sessionDirectory);

	const evidence = await readBuildEvidence(configuration, fileSystem);
	const productAppAsar = Object.freeze({
		path: join(configuration.productRoot, `${configuration.productId}.asar`),
		beforeLaunch: await fileIdentity(
			join(configuration.productRoot, `${configuration.productId}.asar`), fileSystem,
		),
	});
	assertFileIdentity(productAppAsar.beforeLaunch, configuration.packageIdentity.application,
		'Local-assistance product archive differs from its staged package identity.');
	assertFileIdentity(productAppAsar.beforeLaunch, evidence.packageArchive,
		'Local-assistance product archive differs from build evidence.');
	const executableResources = await capturePackagedExecutableResourcesBeforeLaunch({
		executablePath: configuration.productExecutablePath,
		platform: configuration.platform,
	});
	const authenticateWebAssembly = createPackagedWebAssemblyAuthenticator({
		allowFileUrl: true,
		productId: configuration.productId,
		resourcesRoot: executableResources.path,
		webAssemblyResources: executableResources.webAssemblyResources,
	});
	assertResourceIdentity(executableResources.beforeLaunch, evidence.executableResources,
		'Local-assistance product Resources differ from build evidence.');

	const environment = { ...configuration.environment };
	delete environment.ELECTRON_RUN_AS_NODE;
	delete environment.NODE_V8_COVERAGE;
	environment.NODE_V8_COVERAGE = sessionDirectory;

	return Object.freeze({
		environment: Object.freeze(environment),
		sessionDirectory,
		async start({ context, page, mainProcessId, timeoutMs = RELOAD_TIMEOUT_MS }) {
			if (!Number.isSafeInteger(mainProcessId) || mainProcessId <= 0) {
				throw new TypeError('Local-assistance coverage requires the launched main process ID.');
			}
			if (!context || typeof context.newCDPSession !== 'function' || !page) {
				throw new TypeError('Local-assistance coverage requires its live Chromium page.');
			}
			if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
				throw new TypeError('Local-assistance coverage startup timeout must be a positive integer.');
			}
			const deadline = Date.now() + timeoutMs;
			return withinDeadline(async () => {
				const pending = [];
				const rootSession = await context.newCDPSession(page);
				const target = await startTargetCoverage({
					authenticateWebAssembly,
					keepUrl: (url) => typeof url === 'string'
						&& (coverageUrlWithinPath(url, productAppAsar.path, configuration.platform)
							|| coverageUrlWithinPath(url, executableResources.path, configuration.platform)
							|| COVERAGE_INSTRUMENTATION.has(url)),
					page,
					pending,
					rootSession,
				});
				await target.reload(remainingTime(deadline));
				await settlePending(pending);
				return createCollector({ configuration, evidence, executableResources, fileSystem,
					mainProcessId, pending, productAppAsar, sessionDirectory, sessionId, target });
			}, timeoutMs, 'CDP startup');
		},
	});
}

/** Await the exact child exit and reject non-clean exits, including already-exited children. */
export async function awaitLocalAssistanceProcessExit(child, { timeoutMs = 30_000 } = {}) {
	if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
		throw new TypeError('Local-assistance coverage requires its launched child process.');
	}
	let exit;
	if (child.exitCode !== null || child.signalCode !== null) {
		exit = [child.exitCode, child.signalCode];
	} else {
		const timeout = AbortSignal.timeout(timeoutMs);
		try {
			exit = await Promise.race([
				once(child, 'exit', { signal: timeout }),
				once(child, 'error', { signal: timeout }).then(([error]) => { throw error; }),
			]);
		} catch (cause) {
			throw new Error('Local-assistance Electron did not exit cleanly before its deadline.', { cause });
		}
	}
	const [code, signal] = exit;
	if (signal !== null) throw new Error(`Local-assistance Electron exited with signal ${String(signal)}.`);
	if (code !== 0) throw new Error(`Local-assistance Electron exited with code ${String(code)}.`);
	return Object.freeze({ code, signal });
}

/** Collect while the page lives, close its real window, then bind raw files after clean exit. */
export async function completeLocalAssistanceCoverage({
	child, closePage, collector = null, timeoutMs = 30_000,
}) {
	if (typeof closePage !== 'function') throw new TypeError('Local-assistance coverage requires page close control.');
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new TypeError('Local-assistance coverage timeout must be a positive integer.');
	}
	const deadline = Date.now() + timeoutMs;
	await withinDeadline(
		() => collector?.collectBeforeClose(), remainingTime(deadline), 'CDP collection',
	);
	const exited = awaitLocalAssistanceProcessExit(child, { timeoutMs: remainingTime(deadline) })
		.then((value) => ({ value }), (error) => ({ error }));
	let closeFailure = null;
	try { await withinDeadline(closePage, remainingTime(deadline), 'page close'); }
	catch (error) { closeFailure = error; }
	const exitOutcome = await exited;
	if ('error' in exitOutcome) {
		const { error } = exitOutcome;
		if (closeFailure !== null) {
			throw new AggregateError([closeFailure, error],
				'Local-assistance page close and process exit failed.', { cause: error });
		}
		throw error;
	}
	if (closeFailure !== null) throw closeFailure;
	return collector === null ? null : withinDeadline(
		() => collector.finalizeAfterExit(exitOutcome.value), remainingTime(deadline), 'session finalization',
	);
}

function createCollector({ configuration, evidence, executableResources, fileSystem,
	mainProcessId, pending, productAppAsar, sessionDirectory, sessionId, target }) {
	let collected = null;
	let finalized = false;
	return Object.freeze({
		async collectBeforeClose() {
			if (collected !== null) throw new Error('Local-assistance CDP coverage was already collected.');
			await settlePending(pending);
			await target.checkpoint();
			await settlePending(pending);
			const capture = await target.collect();
			await settlePending(pending);
			const sources = Object.fromEntries(capture.sources);
			const excludedInstrumentation = new Set();
			for (const [url, source] of Object.entries(sources)) {
				if (!url.startsWith('soundscaper-coverage:')) continue;
				if (COVERAGE_INSTRUMENTATION.get(url) !== source) {
					throw new Error(`Local-assistance coverage captured unapproved instrumentation ${url}.`);
				}
				excludedInstrumentation.add(url);
				delete sources[url];
			}
			const paths = configuration.platform === 'win32' ? win32 : posix;
			const preloadPath = paths.join(productAppAsar.path, 'desktop/preload.mjs');
			if (!capture.entries.some(({ url }) =>
				coverageUrlMatchesPath(url, preloadPath, configuration.platform)
					&& typeof sources[url] === 'string')) {
				throw new Error('Local-assistance coverage recorded no authenticated product preload.');
			}
			const profile = {
				result: capture.entries.filter(({ url }) => {
					if (url === '') return false;
					if (!url.startsWith('soundscaper-coverage:')) return true;
					if (!excludedInstrumentation.has(url)) {
						throw new Error(`Local-assistance coverage captured no instrumentation source for ${url}.`);
					}
					return false;
				}),
				'script-source-cache': sources,
				'source-map-cache': Object.create(null),
			};
			await atomicWrite(join(sessionDirectory, CDP_FILE), JSON.stringify(profile));
			collected = Object.freeze({
				pausedTargetCounts: sortedRecord(capture.pausedTargetCounts),
				targetCounts: sortedRecord(capture.targetCounts),
				targetTypes: [...capture.targetTypes].sort(),
			});
		},
		async finalizeAfterExit(exit) {
			if (finalized) throw new Error('Local-assistance coverage was already finalized.');
			if (collected === null) throw new Error('Local-assistance CDP coverage was not collected before close.');
			if (exit?.code !== 0 || exit?.signal !== null) {
				throw new Error('Local-assistance coverage requires a clean explicit process exit.');
			}
			finalized = true;
			const afterArchive = await fileIdentity(productAppAsar.path, fileSystem);
			assertFileIdentity(productAppAsar.beforeLaunch, afterArchive,
				'Local-assistance product archive changed between launch and collection.');
			const resources = await capturePackagedExecutableResourcesAfterCollection(executableResources);
			assertResourceIdentity(resources.afterCollection, evidence.executableResources,
				'Local-assistance product Resources differ from build evidence after collection.');
			const inventory = await inventoryRawSession(sessionDirectory, fileSystem);
			const cdpProfile = inventory.find(({ fileName }) => fileName === CDP_FILE);
			const nodeProfiles = inventory.filter(({ fileName }) => NODE_PROFILE_PATTERN.test(fileName));
			if (inventory.length !== nodeProfiles.length + 1 || !cdpProfile) {
				throw new Error('Local-assistance session contains an unexpected coverage entry.');
			}
			if (!nodeProfiles.some(({ fileName }) => {
				const match = NODE_PROFILE_PATTERN.exec(fileName);
				return Number(match?.[1]) === mainProcessId && Number(match?.[3]) === 0;
			})) {
				throw new Error('Local-assistance coverage recorded no main-process thread 0 profile.');
			}
			const manifest = {
				architecture: configuration.architecture,
				captureKind: CAPTURE_KIND,
				capturesChildTargets: true,
				cdpProfile,
				childTargetStrategy: 'recursive-auto-attach-paused',
				executableResources: resources,
				hostExecutablePath: configuration.hostExecutablePath,
				kind: KIND,
				mainProcessId,
				nodeProfiles,
				pausedTargetCounts: collected.pausedTargetCounts,
				platform: configuration.platform,
				processExit: { code: 0, signal: null },
				productAppAsar: { ...productAppAsar, afterCollection: afterArchive },
				productExecutablePath: configuration.productExecutablePath,
				productId: configuration.productId,
				schemaVersion: 2,
				sessionId,
				sourceRevision: configuration.packageIdentity.sourceRevision,
				targetCounts: collected.targetCounts,
				targetTypes: collected.targetTypes,
			};
			const path = join(sessionDirectory, SESSION_FILE);
			await atomicWrite(path, JSON.stringify(manifest));
			return path;
		},
	});
}

async function readBuildEvidence(configuration, fileSystem) {
	const path = join(configuration.productRoot, configuration.productId, 'e2e-coverage/manifest.json');
	let evidence;
	try { evidence = JSON.parse(await fileSystem.readFile(path, 'utf8')); }
	catch (cause) { throw new Error('Local-assistance product build evidence is unreadable.', { cause }); }
	if (evidence?.schemaVersion !== 4 || evidence.kind !== 'soundscaper-e2e-product-build-evidence'
		|| evidence.productId !== configuration.productId
		|| evidence.sourceRevision !== configuration.packageIdentity.sourceRevision
		|| !fileIdentityRecord(evidence.packageArchive) || !resourceIdentityRecord(evidence.executableResources)
		|| !Array.isArray(evidence.webAssemblyResources)) {
		throw new Error('Local-assistance product build evidence is invalid.');
	}
	return evidence;
}

function validateOptions(options) {
	if (!options || typeof options !== 'object') throw new TypeError('Local-assistance coverage options are required.');
	if (!PRODUCTS.has(options.productId)) throw new TypeError('Local-assistance product ID is invalid.');
	if (!PLATFORMS.has(options.platform)) throw new TypeError('Local-assistance platform is invalid.');
	if (!ARCHITECTURES.has(options.architecture)) throw new TypeError('Local-assistance architecture is invalid.');
	for (const name of ['hostExecutablePath', 'productExecutablePath', 'productRoot', 'runRoot']) {
		if (typeof options[name] !== 'string' || !isAbsolute(options[name])) {
			throw new TypeError(`Local-assistance ${name} must be absolute.`);
		}
	}
	const expectedExecutable = resolvePackagedProductExecutable({
		productRoot: options.productRoot,
		productId: options.productId,
		platform: options.platform,
		arch: options.architecture,
	});
	if (options.productExecutablePath !== expectedExecutable) {
		throw new Error('Local-assistance product executable is detached from its canonical staged product.');
	}
	const identity = options.packageIdentity;
	if (identity?.productId !== options.productId
		|| identity.target !== `${options.platform}-${options.architecture}`
		|| typeof identity.sourceRevision !== 'string' || !/^[a-f\d]{40}$/u.test(identity.sourceRevision)
		|| !fileIdentityRecord(identity.application)
		|| identity.application.fileName !== `${options.productId}.asar`) {
		throw new Error('Local-assistance staged package identity is invalid.');
	}
	return Object.freeze({ ...options, environment: options.environment ?? process.env });
}

async function inventoryRawSession(directory, fileSystem) {
	const entries = await fileSystem.readdir(directory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));
	const files = [];
	for (const entry of entries) {
		if (entry.isSymbolicLink() || !entry.isFile()) {
			throw new Error(`Local-assistance session contains an unexpected coverage entry ${entry.name}.`);
		}
		if (entry.name !== CDP_FILE && !NODE_PROFILE_PATTERN.test(entry.name)) {
			throw new Error(`Local-assistance session contains an unexpected coverage entry ${entry.name}.`);
		}
		files.push({ fileName: entry.name, ...await fileIdentity(join(directory, entry.name), fileSystem) });
	}
	return files;
}

async function fileIdentity(path, fileSystem) {
	const metadata = await fileSystem.lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Coverage identity is not a regular file: ${path}.`);
	const bytes = await fileSystem.readFile(path);
	return Object.freeze({ byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex') });
}

async function rawFileSystem() {
	if (!process.versions.electron) return { lstat, readFile, readdir };
	return (await import('node:original-fs')).promises;
}

async function atomicWrite(path, value) {
	const temporary = `${path}.tmp`;
	await writeFile(temporary, value);
	await rename(temporary, path);
}

function assertFileIdentity(actual, expected, message) {
	if (!fileIdentityRecord(actual) || !fileIdentityRecord(expected)
		|| actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) throw new Error(message);
}

function assertResourceIdentity(actual, expected, message) {
	if (!resourceIdentityRecord(actual) || !resourceIdentityRecord(expected)
		|| actual.fileCount !== expected.fileCount || actual.totalBytes !== expected.totalBytes
		|| actual.sha256 !== expected.sha256) throw new Error(message);
}

function fileIdentityRecord(value) {
	return value && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

function resourceIdentityRecord(value) {
	return value && Number.isSafeInteger(value.fileCount) && value.fileCount >= 0
		&& Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0
		&& typeof value.sha256 === 'string' && /^[a-f\d]{64}$/u.test(value.sha256);
}

export function localAssistanceCoverageFileUrl(path, platform = process.platform) {
	const paths = platform === 'win32' ? win32 : posix;
	if (!['darwin', 'linux', 'win32'].includes(platform) || typeof path !== 'string'
		|| !paths.isAbsolute(path)) throw new TypeError('Local-assistance file URL needs an absolute platform path.');
	const url = pathToFileURL(paths.resolve(path), { windows: platform === 'win32' }).href;
	return url.endsWith('/') ? url : `${url}/`;
}

export function coverageUrlMatchesPath(url, expected, platform) {
	const paths = platform === 'win32' ? win32 : posix;
	const actual = coverageUrlPath(url, platform);
	return actual !== null && paths.relative(expected, actual) === '';
}

export function coverageUrlWithinPath(url, root, platform) {
	const paths = platform === 'win32' ? win32 : posix;
	const actual = coverageUrlPath(url, platform);
	if (actual === null) return false;
	const relative = paths.relative(root, actual);
	return relative !== '' && relative !== '..' && !relative.startsWith(`..${paths.sep}`)
		&& !paths.isAbsolute(relative);
}

function coverageUrlPath(url, platform) {
	if (typeof url !== 'string') return null;
	const paths = platform === 'win32' ? win32 : posix;
	try {
		if (url.startsWith('file:')) return fileURLToPath(url, { windows: platform === 'win32' });
		return paths.isAbsolute(url) ? url : null;
	} catch {
		return null;
	}
}

function sortedRecord(value) {
	return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

async function settlePending(pending) {
	while (pending.length > 0) await Promise.all(pending.splice(0, pending.length));
}

function remainingTime(deadline) {
	return Math.max(1, deadline - Date.now());
}

async function withinDeadline(run, timeoutMs, label) {
	let timer;
	const cause = new Error(`Local-assistance ${label} exceeded its ${String(timeoutMs)}ms deadline.`);
	try {
		return await Promise.race([
			Promise.resolve().then(run),
			new Promise((_resolvePromise, reject) => {
				timer = setTimeout(() => reject(new Error(
					`Local-assistance ${label} did not settle before its deadline.`, { cause },
				)), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
