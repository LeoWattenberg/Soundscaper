/* SPDX-License-Identifier: AGPL-3.0-only */

/** Real Electron/IPC/model-store custody, isolated from the user's editor profile. */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { chromium } from '@playwright/test';

import { terminatePackagedRuntime } from '../../browser/helpers/packaged-runtime-process.js';

const STARTUP_TIMEOUT_MS = 90_000;
const LOG_LIMIT = 1_048_576;

export async function launchModelTestElectron({ testInfo, productId = 'framescaper' }) {
	if (process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS !== '1') {
		throw new Error('Real model execution requires SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS=1.');
	}
	if (!['soundscaper', 'framescaper'].includes(productId)) {
		throw new TypeError('The local-model test product is invalid.');
	}
	const executablePath = requiredPath('SOUNDSCAPER_NIGHTLY_TESTS_EXECUTABLE');
	await access(executablePath);
	const profile = await mkdtemp(join(tmpdir(), 'scape-real-models-'));
	let child;
	let browser;
	let output = '';
	let closed = false;
	const processLog = () => output;
	const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-LOG_LIMIT); };
	const close = async () => {
		if (closed) return;
		closed = true;
		try {
			await browser?.close().catch(() => undefined);
			if (child?.pid) await terminatePackagedRuntime(child);
		} finally {
			await rm(profile, { recursive: true, force: true });
			if (testInfo && output) {
				await testInfo.attach('local-model-electron.log', {
					body: output, contentType: 'text/plain',
				});
			}
		}
	};
	try {
		const port = await reserveLoopbackPort();
		const environment = { ...process.env, SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID: productId };
		delete environment.ELECTRON_RUN_AS_NODE;
		child = spawn(executablePath, [
			...(process.env.SOUNDSCAPER_NIGHTLY_TESTS_HOST_ENTRY
				? [requiredPath('SOUNDSCAPER_NIGHTLY_TESTS_HOST_ENTRY')] : []),
			'--soundscaper-nightly-assistance-host',
			`--user-data-dir=${profile}`,
			'--remote-debugging-address=127.0.0.1',
			`--remote-debugging-port=${String(port)}`,
		], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		let spawnError;
		child.once('error', (error) => { spawnError = error; });
		const endpoint = await waitForEndpoint(port, child, () => spawnError, processLog);
		browser = await chromium.connectOverCDP(endpoint, { timeout: STARTUP_TIMEOUT_MS });
		const [context] = browser.contexts();
		if (!context) throw new Error('The real-model Electron host exposed no browser context.');
		const page = context.pages()[0] ?? await context.waitForEvent('page', {
			timeout: STARTUP_TIMEOUT_MS,
		});
		await page.waitForURL((url) => url.protocol === 'file:'
			&& url.pathname.endsWith('/nightly-tests-assistance.html'), {
			timeout: STARTUP_TIMEOUT_MS,
		});
		await page.waitForFunction(() =>
			typeof globalThis.soundscaperDesktop?.v1?.localAssistance?.createJob === 'function'
			&& typeof globalThis.soundscaperDesktop?.v1?.installAssistanceModel === 'function',
		undefined, { timeout: STARTUP_TIMEOUT_MS });
		return Object.freeze({ page, processLog, close,
			installModel: (modelId) => installModel(page, modelId, testInfo),
		});
	} catch (cause) {
		await close();
		throw new Error(`Real-model Electron startup failed.\n${output}`, { cause });
	}
}

async function installModel(page, modelId, testInfo) {
	const installation = await page.evaluate(async (id) => {
		const desktop = globalThis.soundscaperDesktop.v1;
		const started = performance.now();
		const progress = new Map();
		const unsubscribe = desktop.onAssistanceInstallProgress((event) => {
			if (event.modelId === id) progress.set(event.fileName, event);
		});
		try {
			const model = await desktop.installAssistanceModel(id);
			return { model, elapsedMs: performance.now() - started,
				artifacts: Array.from(progress.values()) };
		} finally {
			unsubscribe();
		}
	}, modelId);
	if (installation.model.modelId !== modelId || installation.model.availability !== 'installed') {
		throw new Error(`The real installer did not install ${String(modelId)}.`);
	}
	if (testInfo) await testInfo.attach(`model-install-${modelId}.json`, {
		body: JSON.stringify(installation, null, 2), contentType: 'application/json',
	});
	return installation.model;
}

async function reserveLoopbackPort() {
	const server = createServer();
	server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not reserve the Electron CDP port.');
	await new Promise((resolvePromise, reject) => server.close((error) =>
		error ? reject(error) : resolvePromise()));
	return address.port;
}

async function waitForEndpoint(port, child, spawnError, output) {
	const endpoint = `http://127.0.0.1:${String(port)}`;
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (spawnError()) throw spawnError();
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`The real-model Electron host exited before startup.\n${output()}`);
		}
		try {
			const response = await fetch(`${endpoint}/json/version`, {
				signal: AbortSignal.timeout(2_000),
			});
			if (response.ok) return endpoint;
		} catch { /* The newly spawned host has not opened its CDP endpoint yet. */ }
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`The real-model Electron host did not expose CDP.\n${output()}`);
}

function requiredPath(name) {
	const value = process.env[name];
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError(`${name} must name an absolute path.`);
	}
	return value;
}
