/* SPDX-License-Identifier: AGPL-3.0-only */

/** Real Electron/IPC/model-store custody, isolated from the user's editor profile. */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { chromium } from '@playwright/test';

import { resolvePackagedProductExecutable } from '../../../scripts/lib/desktop-packaged-product-executable.mjs';
import { terminatePackagedRuntime } from '../../browser/helpers/packaged-runtime-process.js';
import {
	createModelInstallEvidence,
	readNightlyPackageIdentity,
	verifyCatalogModelDelivery,
} from './model-delivery-evidence.js';
import {
	completeLocalAssistanceCoverage,
	prepareLocalAssistanceRuntimeCoverage,
} from './runtime-coverage.js';

const STARTUP_TIMEOUT_MS = 90_000;
const PUBLIC_DELIVERY_TIMEOUT_MS = 120_000;
const CONTAINMENT_TIMEOUT_MS = 5_000;
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
	const platform = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform;
	const architecture = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch;
	const target = `${platform}-${architecture}`;
	const productRoot = requiredPath('SOUNDSCAPER_PACKAGED_PRODUCT_ROOT');
	const packageIdentity = await readNightlyPackageIdentity({
		payloadRoot: requiredPath('SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT'),
		productRoot,
		productId,
		target,
	});
	const profile = await mkdtemp(join(tmpdir(), 'scape-real-models-'));
	let child;
	let browser;
	let page;
	let coverageCollector = null;
	let output = '';
	let closed = false;
	const processLog = () => output;
	const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-LOG_LIMIT); };
	const close = async () => {
		if (closed) return;
		closed = true;
		let failure = null;
		try {
			if (child?.pid && page) {
				await completeLocalAssistanceCoverage({
					child,
					closePage: () => page.close(),
					collector: coverageCollector,
					timeoutMs: STARTUP_TIMEOUT_MS,
				});
			} else if (child?.pid) {
				await terminatePackagedRuntime(child);
			}
		} catch (error) {
			failure = error;
			if (child?.pid && child.exitCode === null && child.signalCode === null) {
				try { await terminatePackagedRuntime(child); }
				catch (terminateError) {
					failure = new AggregateError([error, terminateError],
						'Local-model Electron cleanup and containment failed.');
				}
			}
		} finally {
			await closeBrowserConnection(browser).catch(() => undefined);
			await rm(profile, { recursive: true, force: true });
			if (testInfo && output) {
				await testInfo.attach('local-model-electron.log', {
					body: output, contentType: 'text/plain',
				});
			}
		}
		if (failure !== null) throw failure;
	};
	try {
		const port = await reserveLoopbackPort();
		let environment = { ...process.env, SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID: productId };
		delete environment.ELECTRON_RUN_AS_NODE;
		delete environment.NODE_V8_COVERAGE;
		let coverageLaunch = null;
		if (environment.SCAPE_BROWSER_COVERAGE === '1') {
			coverageLaunch = await prepareLocalAssistanceRuntimeCoverage({
				architecture,
				environment,
				hostExecutablePath: executablePath,
				packageIdentity,
				platform,
				productExecutablePath: resolvePackagedProductExecutable({
					productRoot, productId, platform, arch: architecture,
				}),
				productId,
				productRoot,
				runRoot: requiredPath('SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT'),
			});
			environment = coverageLaunch.environment;
		}
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
		page = context.pages()[0] ?? await context.waitForEvent('page', {
			timeout: STARTUP_TIMEOUT_MS,
		});
		await page.waitForURL((url) => url.protocol === 'soundscaper-nightly-assistance:'
			&& url.hostname === 'host' && url.pathname === '/', {
			timeout: STARTUP_TIMEOUT_MS,
		});
		await page.waitForFunction(() =>
			typeof globalThis.soundscaperDesktop?.v1?.localAssistance?.createJob === 'function'
			&& typeof globalThis.soundscaperDesktop?.v1?.installAssistanceModel === 'function',
			undefined, { timeout: STARTUP_TIMEOUT_MS });
		if (coverageLaunch !== null) {
			coverageCollector = await coverageLaunch.start({
				context, page, mainProcessId: child.pid, timeoutMs: STARTUP_TIMEOUT_MS,
			});
			await page.waitForURL((url) => url.protocol === 'soundscaper-nightly-assistance:'
				&& url.hostname === 'host' && url.pathname === '/', { timeout: STARTUP_TIMEOUT_MS });
			await page.waitForFunction(() =>
				typeof globalThis.soundscaperDesktop?.v1?.localAssistance?.createJob === 'function'
				&& typeof globalThis.soundscaperDesktop?.v1?.installAssistanceModel === 'function',
			undefined, { timeout: STARTUP_TIMEOUT_MS });
		}
		return Object.freeze({ page, processLog, close, packageIdentity,
			installModel: (model) => installModel(page, model, packageIdentity, testInfo),
		});
	} catch (cause) {
		await close();
		throw new Error(`Real-model Electron startup failed.\n${output}`, { cause });
	}
}

async function closeBrowserConnection(browser) {
	if (!browser) return;
	let timer;
	try {
		await Promise.race([
			browser.close(),
			new Promise((_resolvePromise, reject) => {
				timer = setTimeout(() => reject(
					new Error('Real-model Electron CDP disconnect exceeded its containment deadline.'),
				), CONTAINMENT_TIMEOUT_MS);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function installModel(page, model, packageIdentity, testInfo) {
	const modelId = model.modelId;
	const delivery = await verifyCatalogModelDelivery(model, {
		signal: AbortSignal.timeout(PUBLIC_DELIVERY_TIMEOUT_MS),
	});
	const installation = await page.evaluate(async (id) => {
		const desktop = globalThis.soundscaperDesktop.v1;
		const started = performance.now();
		const progress = new Map();
		const unsubscribe = desktop.onAssistanceInstallProgress((event) => {
			if (event.modelId === id) progress.set(event.fileName, event);
		});
		try {
			const installed = await desktop.installAssistanceModel(id);
			const authenticated = (await desktop.localAssistance.models())
				.filter((candidate) => candidate.modelId === id);
			if (authenticated.length !== 1 || authenticated[0].version !== installed.version) {
				throw new Error(`The installed model ${id} has no exact full-hash readback.`);
			}
			const model = { ...installed, artifactSha256s: authenticated[0].artifactSha256s };
			return { model, elapsedMs: performance.now() - started,
				artifacts: Array.from(progress.values()) };
		} finally {
			unsubscribe();
		}
	}, modelId);
	if (installation.model.modelId !== modelId || installation.model.availability !== 'installed') {
		throw new Error(`The real installer did not install ${String(modelId)}.`);
	}
	const evidence = createModelInstallEvidence({ model, delivery, installation, packageIdentity });
	if (testInfo) await testInfo.attach(`model-install-${modelId}.json`, {
		body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
	});
	return Object.freeze({ installed: installation.model, evidence });
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
