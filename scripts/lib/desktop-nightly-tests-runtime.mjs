/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, posix, win32 } from 'node:path';
import { startDesktopNightlyTestsProductSites } from './desktop-nightly-tests-product-sites.mjs';
import { resolveDesktopNightlyTestsStaticRequestFile, StaticRequestError } from './desktop-nightly-tests-static-route.mjs';
import { runDesktopNightlyTestsMetricsPhase } from './desktop-nightly-tests-metrics.mjs';
import { PACKAGED_RUNTIME_ARTIFACT_PATHS, runDesktopNightlyTestsPackagedMetricsPhase } from './desktop-nightly-tests-packaged-runtime.mjs';

const RESULT_KIND = 'soundscaper-desktop-nightly-tests';
const PRODUCT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SOURCE_REVISION_PATTERN = /^[a-f\d]{40}$/u;
const STATIC_HOST = '127.0.0.1';
const MIME_TYPES = Object.freeze({
	'.avif': 'image/avif', '.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml',
	'.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
	'.wav': 'audio/wav', '.webm': 'video/webm',
	'.webmanifest': 'application/manifest+json; charset=utf-8', '.webp': 'image/webp',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
});

export function resolveDesktopNightlyTestsOutputRoot({
	platform = process.platform,
	executablePath = process.execPath,
	environment = process.env,
} = {}) {
	const paths = platform === 'win32' ? win32 : posix;
	assertAbsolutePath(executablePath, paths, 'Desktop nightly tests executable path');
	if (platform === 'win32') {
		const portableDirectory = present(environment.PORTABLE_EXECUTABLE_DIR)
			? String(environment.PORTABLE_EXECUTABLE_DIR) : null;
		const portableFile = present(environment.PORTABLE_EXECUTABLE_FILE)
			? String(environment.PORTABLE_EXECUTABLE_FILE) : null;
		if (portableDirectory) assertAbsolutePath(portableDirectory, paths, 'PORTABLE_EXECUTABLE_DIR');
		if (portableFile) {
			assertAbsolutePath(portableFile, paths, 'PORTABLE_EXECUTABLE_FILE');
			if (portableDirectory && paths.dirname(paths.resolve(portableFile)).toLowerCase()
				!== paths.resolve(portableDirectory).toLowerCase()) {
				throw new Error('The portable executable file and directory disagree.');
			}
		}
		if (portableDirectory) return paths.resolve(portableDirectory);
		if (portableFile) return paths.dirname(paths.resolve(portableFile));
	}
	if (platform === 'linux' && present(environment.APPIMAGE)) {
		const appImage = String(environment.APPIMAGE);
		assertAbsolutePath(appImage, paths, 'APPIMAGE');
		return paths.dirname(paths.resolve(appImage));
	}
	if (platform === 'darwin') {
		const normalized = paths.resolve(executablePath);
		const marker = '.app/contents/macos/';
		const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
		if (markerIndex >= 0) {
			const bundle = normalized.slice(0, markerIndex + '.app'.length);
			return paths.dirname(bundle);
		}
	}
	return paths.dirname(paths.resolve(executablePath));
}

export async function createDesktopNightlyTestsRunDirectory({
	outputRoot,
	productId,
	now = new Date(),
} = {}) {
	assertAbsolutePath(outputRoot, { isAbsolute }, 'Desktop nightly tests output root');
	assertProductId(productId);
	const details = await stat(outputRoot).catch((error) => {
		throw new Error(`Desktop nightly tests output root is unavailable: ${message(error)}`, { cause: error });
	});
	if (!details.isDirectory()) throw new Error('Desktop nightly tests output root is not a directory.');
	const timestamp = safeTimestamp(now);
	const runRoot = await mkdtemp(join(outputRoot, `${productId}-playwright-${timestamp}-`));
	return Object.freeze({
		runRoot,
		paths: runPaths(runRoot),
	});
}

export async function startDesktopNightlyTestsStaticServer({ root } = {}) {
	assertAbsolutePath(root, { isAbsolute }, 'Desktop nightly tests static root');
	const staticRoot = await realpath(root).catch((error) => {
		throw new Error(`Desktop nightly tests static root is unavailable: ${message(error)}`, { cause: error });
	});
	const details = await stat(staticRoot);
	if (!details.isDirectory()) throw new Error('Desktop nightly tests static root is not a directory.');
	const server = createServer((request, response) => {
		void serveStaticRequest({ request, response, staticRoot });
	});
	server.maxHeadersCount = 64;
	server.headersTimeout = 10_000;
	server.requestTimeout = 30_000;
	await listen(server);
	const address = server.address();
	if (!address || typeof address === 'string') {
		await closeServer(server);
		throw new Error('Desktop nightly tests static server did not expose a TCP address.');
	}
	let closed = false;
	return Object.freeze({
		baseURL: `http://${STATIC_HOST}:${address.port}`,
		async close() {
			if (closed) return;
			closed = true;
			await closeServer(server);
		},
	});
}

// The staged esbuild binary belongs to whichever platform package the build
// host installed, but esbuild resolves that package from the architecture of the
// process importing it. Those disagree wherever the payload is staged by a Node
// of one architecture and run by an Electron of another — the Windows ARM64 job
// stages with x64 Node — so the launcher names the staged binary outright.
export async function resolveDesktopNightlyTestsEsbuildBinary({ payloadRoot } = {}) {
	assertAbsolutePath(payloadRoot, { isAbsolute }, 'Desktop nightly tests payload root');
	const scopeRoot = join(payloadRoot, 'node_modules', '@esbuild');
	const entries = await readdir(scopeRoot, { withFileTypes: true }).catch(() => null);
	if (entries === null) return null;
	const installed = entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);
	if (installed.length !== 1) return null;
	const [binaryPackage] = installed;
	const binary = join(scopeRoot, binaryPackage, binaryPackage.startsWith('win32-') ? 'esbuild.exe' : 'bin/esbuild');
	// Staging admits exactly one binary package, so an unreadable binary here is a
	// damaged payload. Fall back to esbuild's own lookup rather than failing the
	// launch: that keeps one broken tool from costing the whole suite its run.
	const details = await stat(binary).catch(() => null);
	return details?.isFile() ? binary : null;
}

export function createDesktopNightlyTestsPlaywrightPlan({
	executablePath,
	payloadRoot,
	runRoot,
	baseURL,
	esbuildBinaryPath = null,
	environment = process.env,
} = {}) {
	for (const [value, label] of [
		[executablePath, 'Desktop nightly tests executable path'],
		[payloadRoot, 'Desktop nightly tests payload root'],
		[runRoot, 'Desktop nightly tests run root'],
	]) assertAbsolutePath(value, { isAbsolute }, label);
	if (esbuildBinaryPath !== null) {
		assertAbsolutePath(esbuildBinaryPath, { isAbsolute }, 'Desktop nightly tests esbuild binary path');
	}
	assertLoopbackBaseUrl(baseURL);
	const paths = runPaths(runRoot);
	const env = Object.freeze({
		...environment,
		ELECTRON_RUN_AS_NODE: '1',
		PLAYWRIGHT_BROWSERS_PATH: join(payloadRoot, '.local-browsers'),
		PLAYWRIGHT_HTML_OPEN: 'never',
		...(esbuildBinaryPath === null ? {} : { ESBUILD_BINARY_PATH: esbuildBinaryPath }),
		SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: baseURL,
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	});
	return Object.freeze({
		command: executablePath,
		args: Object.freeze([
			join(payloadRoot, 'node_modules/@playwright/test/cli.js'),
			'test',
			'--config',
			join(payloadRoot, 'playwright.nightly-tests.config.mjs'),
		]),
		cwd: payloadRoot,
		env,
		logFile: paths.consoleLog,
	});
}

export function mapDesktopNightlyTestsExit({ code, signal } = {}) {
	if (signal === 'SIGINT') return Object.freeze({ status: 'interrupted', exitCode: 130 });
	if (signal === 'SIGTERM') return Object.freeze({ status: 'interrupted', exitCode: 143 });
	if (signal !== null && signal !== undefined) return Object.freeze({ status: 'error', exitCode: 2 });
	if (code === 0) return Object.freeze({ status: 'passed', exitCode: 0 });
	if (code === 1) return Object.freeze({ status: 'failed', exitCode: 1 });
	return Object.freeze({ status: 'error', exitCode: 2 });
}

export function createDesktopNightlyTestsResultEnvelope({
	product,
	platform,
	arch,
	sourceRevision = null,
	startedAt,
	finishedAt = null,
	status,
	exitCode = null,
	signal = null,
	failure = null,
} = {}) {
	const productSnapshot = validateProduct(product);
	assertToken(platform, 'runtime platform');
	assertToken(arch, 'runtime architecture');
	if (sourceRevision !== null && !SOURCE_REVISION_PATTERN.test(sourceRevision)) {
		throw new Error('Desktop nightly tests source revision must be one lowercase 40-character Git SHA.');
	}
	const started = dateIso(startedAt, 'startedAt');
	const finished = finishedAt === null ? null : dateIso(finishedAt, 'finishedAt');
	validateResultState({ status, exitCode, signal, failure, finished });
	return Object.freeze({
		schemaVersion: 2,
		kind: RESULT_KIND,
		product: productSnapshot,
		runtime: Object.freeze({ platform, arch }),
		sourceRevision,
		startedAt: started,
		finishedAt: finished,
		status,
		exitCode,
		signal,
		failure,
		artifacts: Object.freeze({
			consoleLog: 'console.log',
			htmlReport: 'playwright-report/index.html',
			jsonReport: 'results.json',
			junitReport: 'junit.xml',
			testResults: 'test-results',
			metricsConsoleLog: 'metrics/console.log',
			metricsHtmlReport: 'metrics/playwright-report/index.html',
			metricsJsonReport: 'metrics/results.json',
			metricsJunitReport: 'metrics/junit.xml',
			metricsRaw: 'metrics/raw.json',
			metricsSummary: 'metrics/summary.json',
			metricsTestResults: 'metrics/test-results',
			...PACKAGED_RUNTIME_ARTIFACT_PATHS,
		}),
	});
}

export async function runDesktopNightlyTests(options, dependencies = {}) {
	const platform = options?.platform ?? process.platform;
	const arch = options?.arch ?? process.arch;
	const environment = options?.environment ?? process.env;
	const now = dependencies.now ?? (() => new Date());
	const startedAt = now();
	const outputRoot = options?.outputRoot ?? resolveDesktopNightlyTestsOutputRoot({
		platform,
		executablePath: options?.executablePath,
		environment,
	});
	const createRunDirectory = dependencies.createRunDirectory ?? createDesktopNightlyTestsRunDirectory;
	const created = await createRunDirectory({
		outputRoot,
		productId: options?.product?.id,
		now: startedAt,
	});
	const runRoot = created.runRoot;
	const writeResult = dependencies.writeResult ?? writeDesktopNightlyTestsResultEnvelope;
	const common = {
		product: options?.product,
		platform,
		arch,
		sourceRevision: options?.sourceRevision ?? null,
		startedAt,
	};
	await writeResult(runRoot, createDesktopNightlyTestsResultEnvelope({
		...common,
		status: 'running',
	}));

	const startStaticServer = dependencies.startStaticServer ?? startDesktopNightlyTestsStaticServer;
	const runPlaywright = dependencies.runPlaywright ?? runPlaywrightChild;
	let sites = null;
	let outcome;
	let signal = null;
	let failure = null;
	try {
		sites = await startDesktopNightlyTestsProductSites({
			payloadRoot: options.payloadRoot, environment, startStaticServer,
		});
		const resolveEsbuildBinary = dependencies.resolveEsbuildBinary ?? resolveDesktopNightlyTestsEsbuildBinary;
		const esbuildBinaryPath = await resolveEsbuildBinary({ payloadRoot: options.payloadRoot });
		const plan = createDesktopNightlyTestsPlaywrightPlan({
			executablePath: options.executablePath,
			payloadRoot: options.payloadRoot,
			runRoot,
			baseURL: sites.origins.soundscaper,
			esbuildBinaryPath,
			environment: sites.browserEnvironment,
		});
		const child = await runPlaywright(plan);
		signal = child.signal ?? null;
		outcome = mapDesktopNightlyTestsExit({ code: child.code, signal });
		if (outcome.status === 'passed' || outcome.status === 'failed') {
			const metrics = await runDesktopNightlyTestsMetricsPhase({
				executablePath: options.executablePath, payloadRoot: options.payloadRoot, runRoot,
				baseURL: sites.origins.soundscaper, esbuildBinaryPath, environment: sites.browserEnvironment,
				sourceRevision: options.sourceRevision ?? null,
			}, { runPlaywright, writeEvidence: dependencies.writeMetricsEvidence });
			const metricsOutcome = mapDesktopNightlyTestsExit(metrics.child);
			signal = metrics.child.signal ?? signal;
			outcome = combineOutcomes(outcome, metricsOutcome, metrics.evidence.passed);
			const packagedMetrics = await runDesktopNightlyTestsPackagedMetricsPhase({
				executablePath: options.executablePath, payloadRoot: options.payloadRoot, runRoot,
				baseURL: sites.origins.soundscaper, esbuildBinaryPath,
				environment: sites.browserEnvironment, platform, arch,
				sourceRevision: options.sourceRevision ?? null,
			}, { runPlaywright, writeEvidence: dependencies.writePackagedMetricsEvidence });
			const packagedOutcome = mapDesktopNightlyTestsExit(packagedMetrics.child);
			signal = packagedMetrics.child.signal ?? signal;
			outcome = combineOutcomes(outcome, packagedOutcome, packagedMetrics.evidence.passed);
		}
	} catch (error) {
		outcome = Object.freeze({ status: 'error', exitCode: 2 }); failure = message(error);
	} finally {
		if (sites) {
			try {
				await sites.close();
			} catch (error) {
				outcome = Object.freeze({ status: 'error', exitCode: 2 });
				failure = combineFailures(failure, `Product server shutdown failed: ${message(error)}`);
			}
		}
	}
	const result = createDesktopNightlyTestsResultEnvelope({
		...common,
		finishedAt: now(),
		status: outcome.status,
		exitCode: outcome.exitCode,
		signal,
		failure,
	});
	await writeResult(runRoot, result);
	return Object.freeze({ exitCode: outcome.exitCode, outputRoot, runRoot, result });
}

async function serveStaticRequest({ request, response, staticRoot }) {
	try {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
			response.end('Method not allowed');
			return;
		}
		const file = await resolveDesktopNightlyTestsStaticRequestFile(
			staticRoot,
			request.url,
			request.headers.accept,
		);
		const extension = extname(file.path).toLowerCase();
		const headers = {
			'Cache-Control': cacheControlFor(file.relativePath),
			'Content-Length': String(file.size),
			'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
			'X-Content-Type-Options': 'nosniff',
			...(file.relativePath === 'service-worker.js' ? { 'Service-Worker-Allowed': '/' } : {}),
		};
		response.writeHead(200, headers);
		if (request.method === 'HEAD') {
			response.end();
			return;
		}
		const stream = createReadStream(file.path);
		stream.once('error', () => response.destroy());
		stream.pipe(response);
	} catch (error) {
		const statusCode = error instanceof StaticRequestError ? error.statusCode : 500;
		if (!response.headersSent) {
			response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
			response.end(statusCode === 500 ? 'Internal server error' : error.message);
		} else {
			response.destroy();
		}
	}
}

function cacheControlFor(relativePath) {
	if (relativePath === 'service-worker.js' || relativePath === 'offline-shell.json') return 'no-store';
	if (relativePath.startsWith('assets/')) return 'public, max-age=31536000, immutable';
	return 'no-cache';
}

function listen(server) {
	return new Promise((resolvePromise, reject) => {
		const onError = (error) => {
			server.off('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			server.off('error', onError);
			resolvePromise();
		};
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen({ host: STATIC_HOST, port: 0, exclusive: true });
	});
}

function closeServer(server) {
	return new Promise((resolvePromise, reject) => {
		server.close((error) => error ? reject(error) : resolvePromise());
		server.closeAllConnections?.();
	});
}

async function runPlaywrightChild(plan) {
	const descriptor = await open(plan.logFile, 'wx');
	const log = descriptor.createWriteStream();
	let child;
	try {
		child = spawn(plan.command, plan.args, {
			cwd: plan.cwd,
			detached: false,
			env: { ...plan.env },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
	} catch (error) {
		await closeWritable(log);
		throw error;
	}
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	try {
		return await new Promise((resolvePromise, reject) => {
			const cleanup = () => {
				child.off('error', onChildError);
				child.off('close', onClose);
				log.off('error', onLogError);
			};
			const onChildError = (error) => { cleanup(); reject(error); };
			const onClose = (code, signal) => { cleanup(); resolvePromise({ code, signal }); };
			const onLogError = (error) => { child.kill(); onChildError(error); };
			child.once('error', onChildError);
			child.once('close', onClose);
			log.once('error', onLogError);
		});
	} finally {
		await closeWritable(log);
	}
}

function closeWritable(stream) {
	if (stream.closed || stream.destroyed) return Promise.resolve();
	return new Promise((resolvePromise, reject) => {
		stream.once('error', reject);
		stream.end(resolvePromise);
	});
}

export async function writeDesktopNightlyTestsResultEnvelope(runRoot, result, dependencies = {}) {
	const target = join(runRoot, 'run.json');
	const temporary = join(runRoot, '.run.json.tmp');
	const previous = join(runRoot, '.run.json.previous');
	const move = dependencies.rename ?? rename;
	try {
		await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
		try {
			await move(temporary, target);
		} catch (error) {
			if (!isReplaceFailure(error)) throw error;
			let preservedPrevious = false;
			try {
				await move(target, previous);
				preservedPrevious = true;
				await move(temporary, target);
			} catch (replacementError) {
				if (preservedPrevious) {
					try {
						await move(previous, target);
					} catch (restoreError) {
						throw new AggregateError(
							[replacementError, restoreError],
							'Desktop nightly tests result replacement and rollback both failed.',
							{ cause: restoreError },
						);
					}
				}
				throw replacementError;
			}
			await unlink(previous).catch(() => undefined);
		}
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
}

function isReplaceFailure(error) {
	return error && typeof error === 'object' && ['EACCES', 'EEXIST', 'EPERM'].includes(error.code);
}

function runPaths(runRoot) {
	return Object.freeze({
		consoleLog: join(runRoot, 'console.log'),
		htmlReport: join(runRoot, 'playwright-report'),
		jsonReport: join(runRoot, 'results.json'),
		junitReport: join(runRoot, 'junit.xml'),
		result: join(runRoot, 'run.json'),
		testResults: join(runRoot, 'test-results'),
	});
}

function safeTimestamp(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('Desktop nightly tests timestamp is invalid.');
	return date.toISOString().replace(/[-:.]/gu, '');
}

function validateProduct(product) {
	if (!product || typeof product !== 'object' || Array.isArray(product)) {
		throw new TypeError('Desktop nightly tests product is required.');
	}
	assertProductId(product.id);
	for (const field of ['name', 'version']) {
		if (typeof product[field] !== 'string' || !product[field].trim()) {
			throw new TypeError(`Desktop nightly tests product ${field} is required.`);
		}
	}
	return Object.freeze({ id: product.id, name: product.name, version: product.version });
}

function validateResultState({ status, exitCode, signal, failure, finished }) {
	if (!['running', 'passed', 'failed', 'error', 'interrupted'].includes(status)) {
		throw new TypeError('Desktop nightly tests result status is invalid.');
	}
	if (failure !== null && (typeof failure !== 'string' || !failure)) {
		throw new TypeError('Desktop nightly tests failure must be null or a non-empty string.');
	}
	if (signal !== null && typeof signal !== 'string') throw new TypeError('Desktop nightly tests signal is invalid.');
	if (status === 'running') {
		if (finished !== null || exitCode !== null || signal !== null || failure !== null) {
			throw new Error('A running desktop nightly tests result cannot be terminal.');
		}
		return;
	}
	if (finished === null || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
		throw new Error('A terminal desktop nightly tests result requires a finish time and exit code.');
	}
}

function assertProductId(value) {
	if (typeof value !== 'string' || !PRODUCT_ID_PATTERN.test(value)) {
		throw new TypeError('Desktop nightly tests product ID is invalid.');
	}
}

function assertToken(value, label) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(value)) {
		throw new TypeError(`Desktop nightly tests ${label} is invalid.`);
	}
}

function assertAbsolutePath(value, paths, label) {
	if (typeof value !== 'string' || !value || !paths.isAbsolute(value)) {
		throw new TypeError(`${label} must be absolute.`);
	}
}

function assertLoopbackBaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Desktop nightly tests base URL is invalid.');
	}
	if (url.protocol !== 'http:' || url.hostname !== STATIC_HOST || url.username || url.password
		|| url.pathname !== '/' || url.search || url.hash || !url.port) {
		throw new TypeError('Desktop nightly tests base URL must be an HTTP 127.0.0.1 origin.');
	}
}

function dateIso(value, label) {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		throw new TypeError(`Desktop nightly tests ${label} is invalid.`);
	}
	return value.toISOString();
}

function present(value) {
	return typeof value === 'string' && value.length > 0;
}

function combineFailures(first, second) {
	return first ? `${first}\n${second}` : second;
}

function combineOutcomes(functional, metrics, metricsPassed) {
	if (functional.status === 'error' || metrics.status === 'error') return Object.freeze({ status: 'error', exitCode: 2 });
	if (metrics.status === 'interrupted') return metrics;
	if (functional.status === 'interrupted') return functional;
	if (functional.status === 'failed' || metrics.status === 'failed' || !metricsPassed) {
		return Object.freeze({ status: 'failed', exitCode: 1 });
	}
	return Object.freeze({ status: 'passed', exitCode: 0 });
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
