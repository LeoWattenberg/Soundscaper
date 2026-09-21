/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX } from '../../desktop/soak-debug-dialog.mjs';
import { SOAK_DEBUG_FLAG } from '../../desktop/soak-debug-process-metrics.mjs';
import {
	capturePackagedAppAsarBeforeLaunch,
	createPackagedRuntimeCoverageCollector,
	packagedRuntimeCoverageLaunch,
} from '../../tests/browser/helpers/packaged-runtime-coverage.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');

export function createSoundscaperDesktopSoakLaunchEnvironment({
	capturePackagedCoverage = false,
	environment = process.env,
} = {}) {
	if (typeof capturePackagedCoverage !== 'boolean') {
		throw new TypeError('Packaged soak coverage selection must be Boolean.');
	}
	if (!capturePackagedCoverage) {
		const childEnvironment = { ...environment };
		delete childEnvironment.ELECTRON_RUN_AS_NODE;
		delete childEnvironment.NODE_V8_COVERAGE;
		return Object.freeze({
			coverageDirectory: null,
			environment: Object.freeze(childEnvironment),
		});
	}
	const launch = packagedRuntimeCoverageLaunch(environment);
	if (launch.coverageDirectory === null) {
		throw new Error('SCAPE_BROWSER_COVERAGE=1 is required for packaged soak coverage.');
	}
	return launch;
}

export async function openSoundscaperDesktopSoakSession(options, dependencies) {
	for (const [candidate, label] of [
		[dependencies?.createPageSession, 'page session factory'],
		[dependencies?.installRuntimeHooks, 'runtime hook installer'],
		[dependencies?.prepareContext, 'context preparer'],
		[dependencies?.waitForEditor, 'editor readiness probe'],
	]) {
		if (typeof candidate !== 'function') throw new TypeError(`Desktop soak ${label} is required.`);
	}
	const executablePath = await resolveDesktopExecutable(options.desktopExecutable);
	const profile = await mkdtemp(join(tmpdir(), 'soundscaper-soak-debug-'));
	const launch = createSoundscaperDesktopSoakLaunchEnvironment({
		capturePackagedCoverage: options.capturePackagedCoverage === true,
		environment: process.env,
	});
	let runtime = null;
	try {
		runtime = await launchDesktopRuntime({
			executablePath, profile, outputDirectory: options.outputDirectory, launch,
			...dependencies,
		});
		return await dependencies.createPageSession({
			...options, page: runtime.page, context: runtime.context, target: 'desktop',
			assertRuntime: () => {
				if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
					const error = new Error(`The packaged app exited during the soak.\n${runtime.output()}`);
					error.code = 'SOAK_RUNTIME_CRASH';
					throw error;
				}
			},
			restartRuntime: async ({ abrupt = false } = {}) => {
				const previous = runtime;
				await retireSoundscaperDesktopSoakRuntime(previous, { abrupt });
				runtime = await relaunchDesktopRuntime({
					executablePath, profile, outputDirectory: options.outputDirectory, launch,
					allowPendingRecovery: abrupt, ...dependencies,
				});
				return { page: runtime.page, context: runtime.context };
			},
			closeRuntime: async ({ failed }) => {
				let operationError;
				try {
					if (runtime.coverageCollector) {
						await retireSoundscaperDesktopSoakRuntime(runtime);
					} else {
						await runtime.browser.close().catch(() => undefined);
						await terminate(runtime.child);
					}
				} catch (error) { operationError = error; }
				let cleanupError;
				if (!(failed && options.keepProfileOnFailure)) {
					try { await rm(profile, { recursive: true, force: true }); }
					catch (error) { cleanupError = error; }
				}
				throwCombined(operationError, cleanupError, 'Packaged soak shutdown and profile cleanup failed.');
			},
		});
	} catch (error) {
		if (runtime) await retireSoundscaperDesktopSoakRuntime(runtime, { abrupt: true }).catch(() => undefined);
		if (!options.keepProfileOnFailure) await rm(profile, { recursive: true, force: true });
		throw error;
	}
}

export async function retireSoundscaperDesktopSoakRuntime(runtime, {
	abrupt = false,
	quitRuntime = quitDesktopRuntime,
	terminateRuntime = terminate,
} = {}) {
	let coverageError;
	// SIGKILL cannot run Node's NODE_V8_COVERAGE exit hook, so persist the main
	// isolate before capturing and detaching Chromium's renderer/preload targets.
	try { await runtime.checkpointMainCoverage?.(); }
	catch (error) { coverageError = error; }
	try { await runtime.coverageCollector?.checkpoint(); }
	catch (error) {
		coverageError = combinedError(
			coverageError, error, 'Packaged soak main and target coverage checkpoints both failed.',
		);
	}
	const collectCoverage = async () => {
		try { await runtime.coverageCollector?.collect(); }
		catch (error) {
			coverageError = combinedError(
				coverageError, error, 'Packaged soak coverage checkpoint and collection both failed.',
			);
		}
	};
	// A forced restart destroys its CDP targets without an exit handshake, so its
	// live ranges must be written first. A graceful quit keeps collection armed
	// through the real renderer/preload shutdown path, then writes the checkpoint.
	if (abrupt) await collectCoverage();
	let shutdownError;
	try {
		if (abrupt) await terminateRuntime(runtime.child, { force: true });
		else await quitRuntime(runtime);
	} catch (error) {
		shutdownError = error;
		await terminateRuntime(runtime.child, { force: abrupt }).catch((terminationError) => {
			shutdownError = new AggregateError(
				[shutdownError, terminationError],
				'Packaged soak graceful and fallback shutdown both failed.',
				{ cause: shutdownError },
			);
		});
	}
	if (!abrupt) await collectCoverage();
	try { await runtime.browser.close(); }
	catch (error) {
		shutdownError = combinedError(
			shutdownError, error, 'Packaged soak runtime and CDP shutdown both failed.',
		);
	}
	throwCombined(coverageError, shutdownError, 'Packaged soak coverage and shutdown both failed.');
}

async function launchDesktopRuntime({
	executablePath,
	profile,
	outputDirectory,
	allowPendingRecovery = false,
	launch,
	installRuntimeHooks,
	prepareContext,
	waitForEditor,
}) {
	const port = await reserveLoopbackPort();
	if (launch.coverageDirectory !== null) await mkdir(launch.coverageDirectory, { recursive: true });
	const appAsar = launch.coverageDirectory === null
		? null
		: await capturePackagedAppAsarBeforeLaunch({ executablePath, platform: process.platform });
	const child = spawn(executablePath, [
		`--user-data-dir=${profile}`,
		`--soundscaper-soak-debug-app-data=${join(profile, 'application-data')}`,
		`${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}${resolve(outputDirectory)}`,
		'--remote-debugging-address=127.0.0.1',
		`--remote-debugging-port=${String(port)}`,
		SOAK_DEBUG_FLAG,
	], { env: launch.environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	let output = '';
	const appendOutput = (chunk) => { output = `${output}${String(chunk)}`.slice(-1_048_576); };
	child.stdout.on('data', appendOutput);
	child.stderr.on('data', appendOutput);
	let browser;
	let coverageCollector;
	try {
		const endpoint = await waitForDevToolsEndpoint(port, child, () => output);
		browser = await chromium.connectOverCDP(endpoint, { timeout: 90_000 });
		const [context] = browser.contexts();
		if (!context) throw bootstrapError('The packaged app exposed no Chromium context.');
		await prepareContext(context);
		const page = await waitForDesktopPage(context, () => output, child);
		await waitForEditor(page, { allowPendingRecovery });
		await page.evaluate(installRuntimeHooks);
		if (launch.coverageDirectory !== null) {
			coverageCollector = createPackagedRuntimeCoverageCollector({
				appAsar,
				architecture: process.arch,
				baseURL: endpoint,
				context,
				coverageDirectory: launch.coverageDirectory,
				executablePath,
				platform: process.platform,
				processId: child.pid,
				productId: 'soundscaper',
			});
			await coverageCollector.start();
			await waitForEditor(page, { allowPendingRecovery });
		}
		return {
			browser, child, context, coverageCollector, output: () => output, page,
			checkpointMainCoverage: launch.coverageDirectory === null
				? null : () => checkpointSoakMainCoverage(page),
		};
	} catch (error) {
		await coverageCollector?.collect().catch(() => undefined);
		await browser?.close().catch(() => undefined);
		await terminate(child, { force: true });
		throw error;
	}
}

async function checkpointSoakMainCoverage(page) {
	const acknowledged = await page.evaluate(async () => {
		const bridge = globalThis.soundscaperDesktop?.v1 ?? globalThis.scapeDesktop?.v1;
		return typeof bridge?.checkpointSoakMainCoverage === 'function'
			? bridge.checkpointSoakMainCoverage() : null;
	});
	if (acknowledged !== true) {
		throw bootstrapError('The packaged app did not acknowledge its main-process coverage checkpoint.');
	}
}

async function relaunchDesktopRuntime(options) {
	const deadline = Date.now() + 45_000;
	let lastError;
	do {
		try { return await launchDesktopRuntime(options); }
		catch (error) {
			lastError = error;
			if (!/writer lease|lease is busy/iu.test(error instanceof Error ? error.message : String(error))) throw error;
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		}
	} while (Date.now() < deadline);
	throw bootstrapError('The packaged app writer leases did not become available after restart.', lastError);
}

async function quitDesktopRuntime(runtime) {
	await runtime.page.locator('[data-window-control="quit"]').click();
	if (!await waitForExit(runtime.child, 30_000)) {
		throw bootstrapError('The packaged app did not complete its UI-requested shutdown.');
	}
}

async function resolveDesktopExecutable(value) {
	if (value !== null) {
		if (typeof value !== 'string' || !isAbsolute(value)) {
			throw bootstrapError('--desktop-executable must be an absolute path.');
		}
		await access(value).catch((cause) => { throw bootstrapError(`Desktop executable not found: ${value}`, cause); });
		return value;
	}
	const suffix = process.platform === 'win32' ? ['win-unpacked', 'Soundscaper.exe']
		: process.platform === 'darwin'
			? ['mac', 'Soundscaper.app', 'Contents', 'MacOS', 'Soundscaper']
			: ['linux-unpacked', 'soundscaper'];
	const candidates = [
		join(REPOSITORY_ROOT, 'release', 'desktop', ...suffix),
		join(REPOSITORY_ROOT, 'release', 'desktop', 'soundscaper-current', ...suffix),
	];
	for (const candidate of candidates) {
		try { await access(candidate); return candidate; } catch { /* Try the next conventional package. */ }
	}
	throw bootstrapError('No packaged Soundscaper executable was found; pass --desktop-executable.');
}

async function reserveLoopbackPort() {
	const server = createServer();
	server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw bootstrapError('Could not reserve a loopback port.');
	await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
	return address.port;
}

async function waitForDevToolsEndpoint(port, child, output) {
	const endpoint = `http://127.0.0.1:${String(port)}`;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw bootstrapError(`The packaged app exited before CDP startup.\n${output()}`);
		try {
			const response = await fetch(`${endpoint}/json/version`);
			if (response.ok) return endpoint;
		} catch { /* The endpoint is not listening yet. */ }
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw bootstrapError(`The packaged app did not expose CDP.\n${output()}`);
}

async function waitForDesktopPage(context, output = () => '', child = null) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child && (child.exitCode !== null || child.signalCode !== null)) {
			throw bootstrapError(`The packaged app exited before its editor page opened.\n${output()}`);
		}
		const page = context.pages().find((candidate) => candidate.url().startsWith('soundscaper-app://bundle/'));
		if (page) return page;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw bootstrapError(`The packaged app did not expose its editor page (pages: ${context.pages().map((page) => page.url()).join(', ') || 'none'}).\n${output()}`);
}

async function terminate(child, { force = false } = {}) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill(force ? 'SIGKILL' : undefined);
	await Promise.race([once(child, 'exit'), new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
	if (!force && child.exitCode === null && child.signalCode === null) {
		child.kill('SIGKILL');
		await once(child, 'exit');
	}
}

async function waitForExit(child, timeoutMs) {
	if (child.exitCode !== null || child.signalCode !== null) return true;
	let timer;
	return Promise.race([
		once(child, 'exit').then(() => true),
		new Promise((resolvePromise) => {
			timer = setTimeout(() => resolvePromise(false), timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

function throwCombined(first, second, message) {
	if (first && second) throw new AggregateError([first, second], message, { cause: first });
	if (first) throw first;
	if (second) throw second;
}

function combinedError(first, second, message) {
	if (first && second) return new AggregateError([first, second], message, { cause: first });
	return first ?? second;
}

function bootstrapError(message, cause) {
	const error = new Error(message, cause === undefined ? undefined : { cause });
	error.code = 'SOAK_BOOTSTRAP';
	return error;
}
