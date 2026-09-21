/* SPDX-License-Identifier: AGPL-3.0-only */

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { startPagesSiteStaticServer } from './pages-site-static-server.mjs';
import { openSoundscaperDesktopSoakSession } from './soundscaper-soak-desktop-playwright.mjs';
import { createSoundscaperSoakWorkflowDriver } from './soundscaper-soak-workflows.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');

export async function openSoundscaperSoakSession(options) {
	if (options?.target === 'browser') return openBrowserSession(options);
	if (options?.target === 'desktop') {
		return openSoundscaperDesktopSoakSession(options, {
			createPageSession: createSoundscaperSoakPageSession,
			installRuntimeHooks: installSoundscaperSoakRuntimeHooks,
			prepareContext: prepareSoundscaperSoakContext,
			waitForEditor,
		});
	}
	throw new TypeError('A Playwright soak-debug session requires browser or desktop.');
}

async function openBrowserSession(options) {
	const outputDirectory = resolve(REPOSITORY_ROOT, 'dist');
	await access(resolve(outputDirectory, 'en/index.html')).catch((cause) => {
		throw bootstrapError('Build Soundscaper with `npm run build` before starting a browser soak.', cause);
	});
	const server = await startPagesSiteStaticServer({ root: outputDirectory });
	let browser;
	try {
		browser = await chromium.launch({ headless: true, args: ['--enable-gpu'] });
		const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
		await prepareSoundscaperSoakContext(context);
		const editorUrl = `${server.baseURL}/embed/en/`;
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
	let runtimeAccessTail = Promise.resolve();
	const observedPages = new WeakSet();
	await bindRuntime(page, context);
	return Object.freeze({ sample, execute, captureFailure, reset, close });

	async function sample(options = {}) {
		const signal = options?.signal ?? null;
		const onStarted = options?.onStarted ?? null;
		if (onStarted !== null && typeof onStarted !== 'function') {
			throw new TypeError('The soak-debug sample start callback must be a function.');
		}
		return withRuntimeAccess(async () => {
			throwIfAborted(signal);
			assertHealthy();
			onStarted?.();
			for (let index = 0; index < 3; index += 1) {
				throwIfAborted(signal);
				await cdp.send('HeapProfiler.collectGarbage');
			}
			throwIfAborted(signal);
			const usage = await cdp.send('Runtime.getHeapUsage');
			throwIfAborted(signal);
			let electronWorkingSetBytes = null;
			let electronWorkingSetUnavailableReason = 'Browser runs have no Electron process.';
			if (target === 'desktop') {
				const metrics = await activePage.evaluate(async () => {
					const bridge = globalThis.soundscaperDesktop?.v1 ?? globalThis.scapeDesktop?.v1;
					return typeof bridge?.readSoakProcessMetrics === 'function'
						? bridge.readSoakProcessMetrics() : null;
				});
				throwIfAborted(signal);
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
		}, signal);
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
		restartInFlight = withRuntimeAccess(async () => {
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
		});
		const pending = restartInFlight;
		void pending.finally(() => {
			if (restartInFlight === pending) restartInFlight = null;
		}).catch(() => undefined);
		return pending;
	}

	async function withRuntimeAccess(operation, signal = null) {
		let release;
		const previous = runtimeAccessTail;
		runtimeAccessTail = new Promise((resolvePromise) => { release = resolvePromise; });
		let acquired = false;
		try {
			await waitForRuntimeAccess(previous, signal);
			acquired = true;
			return await operation();
		} finally {
			if (acquired) release();
			else void previous.finally(release);
		}
	}
}

async function waitForRuntimeAccess(previous, signal) {
	if (!signal) return previous;
	throwIfAborted(signal);
	let abort;
	return Promise.race([
		previous,
		new Promise((_, reject) => {
			abort = () => reject(soakAbortError(signal));
			signal.addEventListener('abort', abort, { once: true });
		}),
	]).finally(() => signal.removeEventListener('abort', abort));
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
	await context.addInitScript(markSoundscaperFirstLaunchSetupComplete);
}

// A fresh soak profile counts as a first launch, and the workspace chooser it
// opens would sit in front of every locator click. The literal mirrors
// src/common/editor/ui/first-launch-setup.ts, which plain node cannot import.
function markSoundscaperFirstLaunchSetupComplete() {
	try {
		globalThis.localStorage?.setItem(
			'soundscaper-first-launch-setup-v1',
			JSON.stringify({ completed: true, workspaceId: 'modern', completedAt: '1970-01-01T00:00:00.000Z' }),
		);
	} catch {
		// Storage-less contexts fall back to the chooser itself.
	}
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
	else {
		await waitForStatus(editor);
		await page.waitForFunction(() => Boolean(document.querySelector('[data-audio-editor]')
			?.getAttribute('data-project-id')), null, { timeout: 30_000 });
	}
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
	if (signal?.aborted) throw soakAbortError(signal);
}

function soakAbortError(signal) {
	const reason = signal?.reason;
	const error = new Error(reason instanceof Error
		? reason.message : 'The soak-debug operation was aborted.');
	const code = reason?.code;
	error.code = ['SOAK_INTERRUPTED', 'SOAK_TARGET_TIMEOUT', 'SOAK_OPERATION_TIMEOUT'].includes(code)
		? code : 'SOAK_INTERRUPTED';
	return error;
}
