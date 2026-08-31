/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

import { SOAK_DEBUG_FLAG } from '../../desktop/soak-debug-process-metrics.mjs';
import { SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX } from '../../desktop/soak-debug-dialog.mjs';
import { createSoundscaperSoakWorkflowDriver } from './soundscaper-soak-workflows.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

export async function openSoundscaperSoakSession(options) {
	if (options?.target === 'browser') return openBrowserSession(options);
	if (options?.target === 'desktop') return openDesktopSession(options);
	throw new TypeError('A Playwright soak-debug session requires browser or desktop.');
}

async function openBrowserSession(options) {
	const outputDirectory = resolve(REPOSITORY_ROOT, 'dist');
	await access(resolve(outputDirectory, 'en/index.html')).catch((cause) => {
		throw bootstrapError('Build Soundscaper with `npm run build` before starting a browser soak.', cause);
	});
	const port = await reserveLoopbackPort();
	const server = await preview({
		configFile: false,
		root: REPOSITORY_ROOT,
		build: { outDir: outputDirectory },
		preview: { host: '127.0.0.1', port, strictPort: true },
		logLevel: 'error',
	});
	let browser;
	try {
		browser = await chromium.launch({ headless: true, args: ['--enable-gpu'] });
		const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
		await prepareSoundscaperSoakContext(context);
		await context.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
		const editorUrl = `http://127.0.0.1:${String(port)}/embed/en/`;
		let page = await openBrowserPage(context, editorUrl);
		return await createSoundscaperSoakPageSession({
			...options, page, context, target: 'browser',
			restartRuntime: async () => {
				await page.close({ runBeforeUnload: false }).catch(() => undefined);
				page = await openBrowserPage(context, editorUrl);
				return { page, context };
			},
			closeRuntime: async () => {
				await browser.close();
				await server.close();
			},
		});
	} catch (error) {
		await browser?.close().catch(() => undefined);
		await server.close().catch(() => undefined);
		throw error;
	}
}

async function openDesktopSession(options) {
	const executablePath = await resolveDesktopExecutable(options.desktopExecutable);
	const profile = await mkdtemp(join(tmpdir(), 'soundscaper-soak-debug-'));
	let runtime = null;
	try {
		runtime = await launchDesktopRuntime({ executablePath, profile, outputDirectory: options.outputDirectory });
		return await createSoundscaperSoakPageSession({
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
				if (abrupt) await terminate(previous.child, { force: true });
				else await quitDesktopRuntime(previous);
				await previous.browser.close().catch(() => undefined);
				runtime = await relaunchDesktopRuntime({
					executablePath, profile, outputDirectory: options.outputDirectory,
					allowPendingRecovery: abrupt,
				});
				return { page: runtime.page, context: runtime.context };
			},
			closeRuntime: async ({ failed }) => {
				await runtime.browser.close().catch(() => undefined);
				await terminate(runtime.child);
				if (!(failed && options.keepProfileOnFailure)) {
					await rm(profile, { recursive: true, force: true });
				}
			},
		});
	} catch (error) {
		await runtime?.browser.close().catch(() => undefined);
		if (runtime) await terminate(runtime.child);
		if (!options.keepProfileOnFailure) await rm(profile, { recursive: true, force: true });
		throw error;
	}
}

async function quitDesktopRuntime(runtime) {
	await runtime.page.locator('[data-window-control="quit"]').click();
	if (!await waitForExit(runtime.child, 30_000)) {
		throw bootstrapError('The packaged app did not complete its UI-requested shutdown.');
	}
}

async function relaunchDesktopRuntime(options) {
	const deadline = Date.now() + 45_000;
	let lastError;
	do {
		try {
			return await launchDesktopRuntime(options);
		} catch (error) {
			lastError = error;
			if (!/writer lease|lease is busy/iu.test(error instanceof Error ? error.message : String(error))) {
				throw error;
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		}
	} while (Date.now() < deadline);
	throw bootstrapError('The packaged app writer leases did not become available after restart.', lastError);
}

async function launchDesktopRuntime({
	executablePath, profile, outputDirectory, allowPendingRecovery = false,
}) {
	const port = await reserveLoopbackPort();
	const environment = { ...process.env };
	delete environment.ELECTRON_RUN_AS_NODE;
	const child = spawn(executablePath, [
		`--user-data-dir=${profile}`,
		`--soundscaper-soak-debug-app-data=${join(profile, 'application-data')}`,
		`${SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX}${resolve(outputDirectory)}`,
		'--remote-debugging-address=127.0.0.1',
		`--remote-debugging-port=${String(port)}`,
		SOAK_DEBUG_FLAG,
	], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	let output = '';
	const appendOutput = (chunk) => { output = `${output}${String(chunk)}`.slice(-1_048_576); };
	child.stdout.on('data', appendOutput);
	child.stderr.on('data', appendOutput);
	let browser;
	try {
		const endpoint = await waitForDevToolsEndpoint(port, child, () => output);
		browser = await chromium.connectOverCDP(endpoint, { timeout: 90_000 });
		const [context] = browser.contexts();
		if (!context) throw bootstrapError('The packaged app exposed no Chromium context.');
		await prepareSoundscaperSoakContext(context);
		const page = await waitForDesktopPage(context, () => output, child);
		await waitForEditor(page, { allowPendingRecovery });
		await page.evaluate(installSoundscaperSoakRuntimeHooks);
		return { browser, child, context, output: () => output, page };
	} catch (error) {
		await browser?.close().catch(() => undefined);
		await terminate(child, { force: true });
		throw error;
	}
}

export async function createSoundscaperSoakPageSession({
	page, context, target, outputDirectory, onRuntimeEvent, closeRuntime,
	assertRuntime = () => undefined, restartRuntime = null,
}) {
	let closed = false;
	let restarting = false;
	let runtimeCrash = null;
	let activePage = page;
	let activeContext = context;
	let cdp = null;
	let workflows = null;
	let restartInFlight = null;
	const observedPages = new WeakSet();
	await bindRuntime(page, context);
	return Object.freeze({ sample, execute, captureFailure, reset, close });

	async function sample() {
		assertHealthy();
		for (let index = 0; index < 3; index += 1) await cdp.send('HeapProfiler.collectGarbage');
		const usage = await cdp.send('Runtime.getHeapUsage');
		let electronWorkingSetBytes = null;
		let electronWorkingSetUnavailableReason = 'Browser runs have no Electron process.';
		if (target === 'desktop') {
			const metrics = await activePage.evaluate(async () => {
				const bridge = globalThis.soundscaperDesktop?.v1 ?? globalThis.scapeDesktop?.v1;
				return typeof bridge?.readSoakProcessMetrics === 'function'
					? bridge.readSoakProcessMetrics() : null;
			});
			if (metrics?.schemaVersion === 1 && Number.isSafeInteger(metrics.workingSetBytes)
				&& metrics.workingSetBytes >= 0) {
				electronWorkingSetBytes = metrics.workingSetBytes;
				electronWorkingSetUnavailableReason = null;
			} else {
				electronWorkingSetUnavailableReason = 'The packaged app did not expose flag-gated process metrics.';
			}
		}
		return {
			usedJsHeapBytes: usage.usedSize,
			forcedCollections: 3,
			electronWorkingSetBytes,
			electronWorkingSetUnavailableReason,
		};
	}

	async function execute(operationId, operationOptions) {
		assertHealthy();
		return workflows.execute(operationId, operationOptions);
	}

	async function captureFailure() {
		if (activePage.isClosed()) return null;
		return activePage.screenshot({ type: 'png', animations: 'disabled' });
	}

	async function reset({ signal } = {}) {
		assertHealthy();
		throwIfAborted(signal);
		if (restartInFlight) await restartInFlight.catch(() => undefined);
		await restartForWorkflow({ abrupt: true });
		throwIfAborted(signal);
	}

	async function close(options) {
		if (closed) return;
		closed = true;
		await cdp.detach().catch(() => undefined);
		await closeRuntime(options);
	}

	function assertHealthy() {
		assertRuntime();
		if (runtimeCrash) throw runtimeCrash;
	}

	function recordRuntimeCrash(message) {
		if (runtimeCrash) return;
		runtimeCrash = new Error(message);
		runtimeCrash.code = 'SOAK_RUNTIME_CRASH';
		void onRuntimeEvent?.('page-error', {
			name: 'RendererCrash', code: 'RENDERER_CRASH', message,
		});
	}

	async function bindRuntime(nextPage, nextContext) {
		activePage = nextPage;
		activeContext = nextContext;
		const boundPage = nextPage;
		if (!observedPages.has(boundPage)) {
			observedPages.add(boundPage);
			boundPage.on('pageerror', (error) => {
				if (!restarting) void onRuntimeEvent?.('page-error', runtimeError(error));
			});
			boundPage.on('console', (message) => {
				if (!restarting && message.type() === 'error') {
					void onRuntimeEvent?.('console-error', {
						name: 'ConsoleError', code: 'CONSOLE_ERROR', message: message.text(),
					});
				}
			});
			boundPage.on('crash', () => {
				if (!restarting && activePage === boundPage) recordRuntimeCrash('The renderer crashed.');
			});
			boundPage.on('close', () => {
				if (!closed && !restarting && activePage === boundPage) {
					recordRuntimeCrash('The renderer closed unexpectedly.');
				}
			});
		}
		cdp = await nextContext.newCDPSession(boundPage);
		await cdp.send('HeapProfiler.enable');
		workflows = createSoundscaperSoakWorkflowDriver({
			page: boundPage, target, outputDirectory,
			...(typeof restartRuntime === 'function' ? { restartRuntime: restartForWorkflow } : {}),
		});
	}

	function restartForWorkflow(options = {}) {
		if (restartInFlight) return restartInFlight;
		restartInFlight = (async () => {
			restarting = true;
			try {
				await cdp?.detach().catch(() => undefined);
				const replacement = typeof restartRuntime === 'function'
					? await restartRuntime(options)
					: await replaceBrowserRuntime(activePage, activeContext);
				await bindRuntime(replacement.page, replacement.context);
				return activePage;
			} finally {
				restarting = false;
			}
		})();
		const pending = restartInFlight;
		void pending.finally(() => {
			if (restartInFlight === pending) restartInFlight = null;
		}).catch(() => undefined);
		return pending;
	}
}

async function replaceBrowserRuntime(page, context) {
	const url = page.url();
	await page.close({ runBeforeUnload: false }).catch(() => undefined);
	return { page: await openBrowserPage(context, url), context };
}

async function openBrowserPage(context, url) {
	const page = await context.newPage();
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await waitForEditor(page);
	return page;
}

export async function prepareSoundscaperSoakContext(context) {
	await context.addInitScript(installSoundscaperSoakRuntimeHooks);
}

function installSoundscaperSoakRuntimeHooks() {
	Object.defineProperty(globalThis, 'showSaveFilePicker', {
		configurable: true,
		value: undefined,
	});
	const storage = navigator.storage ?? {};
	Object.defineProperty(storage, 'estimate', {
		configurable: true,
		value: () => Promise.resolve({ usage: 1024 ** 2, quota: 2 * 1024 ** 3 }),
	});
	Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
	const mediaDevices = navigator.mediaDevices ?? {};
	Object.defineProperty(mediaDevices, 'getUserMedia', {
		configurable: true,
		value: async () => {
			const audio = new AudioContext({ sampleRate: 48_000 });
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			const destination = audio.createMediaStreamDestination();
			oscillator.frequency.value = 440;
			gain.gain.value = 0.1;
			oscillator.connect(gain).connect(destination);
			oscillator.start();
			await audio.resume();
			for (const track of destination.stream.getAudioTracks()) {
				const stop = track.stop.bind(track);
				let stopped = false;
				Object.defineProperty(track, 'getSettings', {
					configurable: true,
					value: () => ({ channelCount: 1, sampleRate: 48_000, latency: 0 }),
				});
				Object.defineProperty(track, 'stop', {
					configurable: true,
					value: () => {
						if (stopped) return;
						stopped = true;
						stop();
						oscillator.stop();
						void audio.close();
					},
				});
			}
			return destination.stream;
		},
	});
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
}

async function waitForEditor(page, { allowPendingRecovery = false } = {}) {
	const editor = page.locator('[data-audio-editor]');
	await editor.waitFor({ state: 'visible', timeout: 30_000 });
	await page.waitForFunction(() => document.querySelector('[data-audio-editor]')
		?.getAttribute('data-audio-editor-bound') === 'true');
	if (allowPendingRecovery) await waitForStatusOrRecovery(editor);
	else await waitForStatus(editor);
	const decline = page.getByRole('button', { name: /^(Decline|Ablehnen)$/u });
	if (await decline.isVisible().catch(() => false)) await decline.click();
	return editor;
}

async function waitForStatusOrRecovery(editor) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (await editor.locator('[data-status]').getAttribute('data-state') === 'success') return;
		if (await editor.page().locator('[data-take-cycle-recovery-dialog="true"]')
			.isVisible().catch(() => false)) return;
		await editor.page().waitForTimeout(50);
	}
	throw bootstrapError('The packaged app reached neither ready state nor interrupted-take recovery.');
}

async function waitForStatus(editor) {
	await editor.page().waitForFunction(() => document.querySelector('[data-status]')
		?.getAttribute('data-state') === 'success', null, { timeout: 30_000 });
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

function runtimeError(error) {
	return {
		name: error instanceof Error ? error.name : 'NonError',
		code: typeof error?.code === 'string' ? error.code : 'UNCLASSIFIED',
		message: error instanceof Error ? error.message : String(error),
	};
}

function bootstrapError(message, cause) {
	const error = new Error(message, cause === undefined ? undefined : { cause });
	error.code = 'SOAK_BOOTSTRAP';
	return error;
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw signal.reason instanceof Error
		? signal.reason : new Error('The soak-debug operation was aborted.');
}
