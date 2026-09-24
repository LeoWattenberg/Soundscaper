/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, expect, test as base } from '@playwright/test';

import {
	packagedRuntimeChromiumArguments,
	resolvePackagedProductExecutable,
	seedDesktopNightlyPackagedLocale,
} from '../../../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';
import {
	bypassPackagedRuntimeServiceWorker,
	packagedRuntimeProductBaseURL,
	usesPackagedRuntimeDiagnosticPage,
} from './packaged-runtime-page.js';
import {
	createPackagedRuntimeAudioWave,
	packagedRuntimeAudioArguments,
} from './packaged-runtime-audio-fixture.js';
import {
	capturePackagedAppAsarBeforeLaunch,
	createPackagedRuntimeCoverageCollector,
	packagedRuntimeCoverageLaunch,
} from './packaged-runtime-coverage.js';
import {
	capturePackagedExecutableResourcesBeforeLaunch,
} from '../../../scripts/lib/packaged-executable-resource-identity.mjs';
import {
	requestPackagedRuntimeShutdown,
	terminatePackagedRuntime,
} from './packaged-runtime-process.js';

const standardTest = base.extend({
	runtimeBrowser: async ({ browser }, use) => use(browser),
	runtimeBrowserName: async ({ browserName }, use) => use(browserName),
	runtimeBaseURL: async ({ baseURL }, use) => use(baseURL),
});

const packagedTest = base.extend({
	// One worker maps to one product. Reusing that process avoids Electron's
	// single-instance/CDP transition between serial tests on Windows.
	packagedRuntime: [async ({ browserName: _browserName }, use, workerInfo) => {
		const productId = workerInfo.project.metadata.productId;
		const baseURL = packagedRuntimeProductBaseURL(productId);
		const runtimePlatform = requiredEnvironment('SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM');
		const executablePath = resolvePackagedProductExecutable({
			productRoot: requiredEnvironment('SOUNDSCAPER_PACKAGED_PRODUCT_ROOT'),
			productId,
			platform: runtimePlatform,
			arch: requiredEnvironment('SOUNDSCAPER_PACKAGED_RUNTIME_ARCH'),
		});
		await access(executablePath);
		const profile = await mkdtemp(join(tmpdir(), `${productId}-packaged-metrics-`));
		await seedDesktopNightlyPackagedLocale(profile);
		const audioFixtureArguments = await prepareAudioFixture(workerInfo, productId, profile);
		const port = await reserveLoopbackPort();
		const coverageLaunch = packagedRuntimeCoverageLaunch(process.env);
		if (coverageLaunch.coverageDirectory !== null) {
			await mkdir(coverageLaunch.coverageDirectory, { recursive: true });
		}
		const [appAsar, executableResources] = coverageLaunch.coverageDirectory === null
			? [null, null]
			: await Promise.all([
				capturePackagedAppAsarBeforeLaunch({ executablePath, platform: runtimePlatform }),
				capturePackagedExecutableResourcesBeforeLaunch({
					executablePath,
					platform: runtimePlatform,
				}),
			]);
		const child = spawn(executablePath, [
			...packagedRuntimeChromiumArguments(runtimePlatform),
			...audioFixtureArguments,
			`--user-data-dir=${profile}`,
			`--soundscaper-nightly-tests-app-data=${join(profile, 'application-data')}`,
			'--remote-debugging-address=127.0.0.1',
			`--remote-debugging-port=${String(port)}`,
			`--soundscaper-nightly-tests-base-url=${baseURL}`,
		], {
			env: coverageLaunch.environment,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		let output = '';
		const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1_048_576); };
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		let browser;
		let context;
		let coverageCollector;
		try {
			const endpoint = await waitForDevToolsEndpoint(port, child, () => output);
			try {
				browser = await chromium.connectOverCDP(endpoint, { timeout: 90_000 });
			} catch (cause) {
				throw new Error(`Packaged runtime CDP connection failed.\n${output}`, { cause });
			}
			[context] = browser.contexts();
			if (!context) throw new Error('Packaged runtime exposed no Chromium context.');
			if (coverageLaunch.coverageDirectory !== null) {
				coverageCollector = createPackagedRuntimeCoverageCollector({
					appAsar,
					architecture: requiredEnvironment('SOUNDSCAPER_PACKAGED_RUNTIME_ARCH'),
					baseURL,
					browser,
					context,
					coverageDirectory: coverageLaunch.coverageDirectory,
					executablePath,
					executableResources,
					platform: runtimePlatform,
					processId: child.pid,
					productId,
				});
				await coverageCollector.start();
			}
			await use(Object.freeze({ baseURL, browser, executablePath, output: () => output }));
		} finally {
			await finishPackagedRuntime({ browser, child, context, coverageCollector, productId, profile });
		}
	}, { scope: 'worker' }],
	packagedRuntimeProcessLog: [async ({ packagedRuntime }, use, testInfo) => {
		await use();
		const output = packagedRuntime.output();
		if (output) await testInfo.attach('packaged-runtime-process.log', { body: output, contentType: 'text/plain' });
	}, { auto: true }],
	context: async ({ packagedRuntime }, use) => {
		const [context] = packagedRuntime.browser.contexts();
		if (!context) throw new Error('Packaged runtime exposed no Chromium context.');
		await use(context);
	},
	page: async ({ context }, use, testInfo) => {
		const diagnosticPage = usesPackagedRuntimeDiagnosticPage(testInfo.file);
		const page = await waitForRuntimePage(context, diagnosticPage);
		// The preceding product diagnostic may leave this shared HTTP origin under
		// service-worker control, which would hide synthetic route requests from Playwright.
		const releaseBypass = diagnosticPage
			? await bypassPackagedRuntimeServiceWorker(context, page)
			: null;
		try {
			await use(page);
		} finally {
			await releaseBypass?.();
		}
	},
	runtimeBrowser: async ({ packagedRuntime }, use) => use(Object.freeze({
		version: () => packagedRuntime.browser.version(),
		browserType: () => Object.freeze({ executablePath: () => packagedRuntime.executablePath }),
	})),
	runtimeBrowserName: async ({ packagedRuntime }, use) => {
		void packagedRuntime;
		await use('chromium');
	},
	runtimeBaseURL: async ({ packagedRuntime }, use) => {
		await use(packagedRuntime.baseURL);
	},
});

export const test = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS === '1'
	? packagedTest
	: standardTest;
export { expect };

async function finishPackagedRuntime({ browser, child, context, coverageCollector, productId, profile }) {
	let shutdownError;
	let coverageError;
	try {
		await coverageCollector?.checkpoint();
	} catch (error) {
		coverageError = error;
	}
	try {
		let graceful = false;
		try {
			graceful = context === undefined ? false : await requestPackagedRuntimeShutdown({
				child,
				checkpoint: coverageCollector === undefined ? null : () => coverageCollector.checkpoint(),
				context,
				productId,
			});
		} catch (error) {
			shutdownError = error;
		}
		try {
			await coverageCollector?.collect();
		} catch (error) {
			coverageError ??= error;
		}
		await browser?.close().catch(() => undefined);
		if (!graceful) await terminatePackagedRuntime(child);
	} finally {
		await rm(profile, { recursive: true, force: true });
	}
	if (coverageError) throw coverageError;
	if (shutdownError) throw shutdownError;
}

async function prepareAudioFixture(workerInfo, productId, profile) {
	if (workerInfo.project.metadata.packagedAudioDeviceFixture !== true) return [];
	if (productId !== 'soundscaper') {
		throw new Error('The packaged audio-device fixture is Soundscaper-only.');
	}
	const wavePath = join(profile, 'fake-audio-input.wav');
	await writeFile(wavePath, createPackagedRuntimeAudioWave());
	return packagedRuntimeAudioArguments(wavePath);
}

async function reserveLoopbackPort() {
	const server = createServer();
	server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not reserve a packaged-runtime CDP port.');
	await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
	return address.port;
}

async function waitForDevToolsEndpoint(port, child, output) {
	const endpoint = `http://127.0.0.1:${String(port)}`;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Packaged runtime exited before CDP startup.\n${output()}`);
		try {
			const response = await fetch(`${endpoint}/json/version`);
			if (response.ok) return endpoint;
		} catch { /* The endpoint is not listening yet. */ }
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Packaged runtime did not expose CDP.\n${output()}`);
}

async function waitForRuntimePage(context, standaloneHarness) {
	const matches = (page) => standaloneHarness
		? page.url().startsWith('http://127.0.0.1:')
		: /^(?:soundscaper|framescaper)-app:\/\/bundle\//u.test(page.url());
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const page = context.pages().find(matches);
		if (page) {
			try {
				await page.waitForLoadState('load');
				return page;
			} catch {
				// The product may replace its initial document while startup is still settling.
			}
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Packaged runtime did not expose its ${standaloneHarness ? 'diagnostic' : 'product'} page.`);
}

function requiredEnvironment(name) {
	const value = process.env[name];
	if (typeof value !== 'string' || !value) throw new Error(`${name} is required for packaged-runtime tests.`);
	return value;
}
