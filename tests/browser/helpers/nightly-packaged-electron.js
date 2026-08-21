/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, expect, test as base } from '@playwright/test';

import {
	packagedRuntimeChromiumArguments,
	resolvePackagedProductExecutable,
} from '../../../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';

const standardTest = base.extend({
	runtimeBrowser: async ({ browser }, use) => use(browser),
	runtimeBrowserName: async ({ browserName }, use) => use(browserName),
	runtimeBaseURL: async ({ baseURL }, use) => use(baseURL),
});

const packagedTest = base.extend({
	packagedRuntime: async ({ browserName: _browserName }, use, testInfo) => {
		const productId = testInfo.project.metadata.productId;
		const executablePath = resolvePackagedProductExecutable({
			productRoot: requiredEnvironment('SOUNDSCAPER_PACKAGED_PRODUCT_ROOT'),
			productId,
			platform: requiredEnvironment('SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM'),
			arch: requiredEnvironment('SOUNDSCAPER_PACKAGED_RUNTIME_ARCH'),
		});
		await access(executablePath);
		const profile = await mkdtemp(join(tmpdir(), `${productId}-packaged-metrics-`));
		const port = await reserveLoopbackPort();
		const environment = { ...process.env };
		delete environment.ELECTRON_RUN_AS_NODE;
		const child = spawn(executablePath, [
			...packagedRuntimeChromiumArguments(requiredEnvironment('SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM')),
			`--user-data-dir=${profile}`,
			`--soundscaper-nightly-tests-app-data=${join(profile, 'application-data')}`,
			'--remote-debugging-address=127.0.0.1',
			`--remote-debugging-port=${String(port)}`,
			`--soundscaper-nightly-tests-base-url=${requiredEnvironment('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL')}`,
		], {
			env: environment,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		let output = '';
		const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1_048_576); };
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		let browser;
		try {
			const endpoint = await waitForDevToolsEndpoint(port, child, () => output);
			browser = await chromium.connectOverCDP(endpoint);
			await use(Object.freeze({ browser, executablePath }));
		} finally {
			await browser?.close().catch(() => undefined);
			await terminate(child);
			await rm(profile, { recursive: true, force: true });
			if (output) await testInfo.attach('packaged-runtime-process.log', { body: output, contentType: 'text/plain' });
		}
	},
	context: async ({ packagedRuntime }, use) => {
		const [context] = packagedRuntime.browser.contexts();
		if (!context) throw new Error('Packaged runtime exposed no Chromium context.');
		await use(context);
	},
	page: async ({ context }, use, testInfo) => {
		const standaloneHarness = /audio-editor-m4(?:b2)?-/u.test(testInfo.file);
		const page = await waitForRuntimePage(context, standaloneHarness);
		await use(page);
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
		void packagedRuntime;
		await use(requiredEnvironment('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL'));
	},
});

export const test = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS === '1'
	? packagedTest
	: standardTest;
export { expect };

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
	const deadline = Date.now() + 30_000;
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

async function terminate(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill();
	await Promise.race([
		once(child, 'exit'),
		new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
	]);
}

function requiredEnvironment(name) {
	const value = process.env[name];
	if (typeof value !== 'string' || !value) throw new Error(`${name} is required for packaged-runtime tests.`);
	return value;
}
