/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { startPagesSiteStaticServer } from './pages-site-static-server.mjs';

export const DUAL_ORIGIN_ARTIFACT_PATHS = Object.freeze({
	dualOriginConsoleLog: 'e2e-coverage/dual-origin/console.log',
	dualOriginHtmlReport: 'e2e-coverage/dual-origin/playwright-report/index.html',
	dualOriginJsonReport: 'e2e-coverage/dual-origin/results.json',
	dualOriginJunitReport: 'e2e-coverage/dual-origin/junit.xml',
	dualOriginTestResults: 'e2e-coverage/dual-origin/test-results',
});

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

export function createDesktopNightlyTestsDualOriginPlan({
	executablePath,
	payloadRoot,
	runRoot,
	origins,
	esbuildBinaryPath = null,
	environment = process.env,
}) {
	for (const [value, label] of [
		[executablePath, 'Nightly tests executable'],
		[payloadRoot, 'Nightly tests payload'],
		[runRoot, 'Nightly tests run'],
	]) assertAbsolute(value, label);
	if (esbuildBinaryPath !== null) assertAbsolute(esbuildBinaryPath, 'Nightly tests esbuild binary');
	const admittedOrigins = validateOrigins(origins);
	const coverageSites = PRODUCT_IDS.map((productId) => Object.freeze({
		productId,
		origin: admittedOrigins[productId],
		outputDirectory: join(payloadRoot, 'sites', productId),
	}));
	return Object.freeze({
		command: executablePath,
		args: Object.freeze([
			join(payloadRoot, 'node_modules/@playwright/test/cli.js'),
			'test',
			'--config',
			join(payloadRoot, 'playwright.nightly-dual-origin.config.mjs'),
		]),
		cwd: payloadRoot,
		env: Object.freeze({
			...environment,
			ELECTRON_RUN_AS_NODE: '1',
			PLAYWRIGHT_BROWSERS_PATH: join(payloadRoot, '.local-browsers'),
			PLAYWRIGHT_HTML_OPEN: 'never',
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_DIRECTORY: join(runRoot, 'coverage/v8-browser'),
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify(coverageSites),
			SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify(admittedOrigins),
			...(esbuildBinaryPath === null ? {} : { ESBUILD_BINARY_PATH: esbuildBinaryPath }),
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
		}),
		logFile: join(runRoot, DUAL_ORIGIN_ARTIFACT_PATHS.dualOriginConsoleLog),
	});
}

export async function runDesktopNightlyTestsDualOriginPhase(options, dependencies = {}) {
	const sites = await loadDualOriginSites(options.payloadRoot);
	const startPagesSiteServer = dependencies.startPagesSiteServer ?? startPagesSiteStaticServer;
	const servers = [];
	await mkdir(join(options.runRoot, 'e2e-coverage/dual-origin'), { recursive: true });
	let result;
	try {
		for (const site of sites) {
			const expected = new URL(site.origin);
			const server = await startPagesSiteServer({
				root: site.root,
				host: expected.hostname,
				port: Number(expected.port),
			});
			if (server?.baseURL !== site.origin || typeof server.close !== 'function') {
				await rejectInvalidServer(server,
					`The ${site.productId} Pages server did not bind its authenticated build origin.`);
			}
			servers.push(server);
		}
		const plan = createDesktopNightlyTestsDualOriginPlan({
			...options,
			origins: Object.fromEntries(sites.map(({ productId, origin }) => [productId, origin])),
		});
		const child = await dependencies.runPlaywright(plan);
		result = Object.freeze({
			child,
			diagnostics: Object.freeze({ passed: child.code === 0 && child.signal == null }),
		});
	} catch (error) {
		try {
			await closeServers(servers);
		} catch (closeError) {
			throw new AggregateError(
				[error, closeError],
				'Dual-origin coverage failed and its Pages servers could not close.',
				{ cause: closeError },
			);
		}
		throw error;
	}
	await closeServers(servers);
	return result;
}

async function loadDualOriginSites(payloadRoot) {
	assertAbsolute(payloadRoot, 'Nightly tests payload');
	const sites = [];
	for (const productId of PRODUCT_IDS) {
		const root = join(payloadRoot, 'sites', productId);
		let evidence;
		try {
			evidence = JSON.parse(await readFile(join(root, '.browser-product-build.json'), 'utf8'));
		} catch (error) {
			throw new Error(`The ${productId} browser build evidence is unreadable.`, { cause: error });
		}
		if (evidence?.schemaVersion !== 2 || evidence.productId !== productId) {
			throw new Error(`The ${productId} browser build evidence names the wrong product.`);
		}
		const origin = loopbackOrigin(evidence.origin, `${productId} browser build evidence`);
		sites.push(Object.freeze({ productId, origin, root }));
	}
	validateOrigins(Object.fromEntries(sites.map(({ productId, origin }) => [productId, origin])));
	return Object.freeze(sites);
}

async function closeServers(servers) {
	const outcomes = await Promise.allSettled(servers.map((server) => server.close()));
	const failures = outcomes.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Dual-origin Pages servers could not close.');
}

async function rejectInvalidServer(server, message) {
	const failure = new Error(message);
	if (typeof server?.close !== 'function') throw failure;
	try {
		await server.close();
	} catch (closeError) {
		throw new AggregateError(
			[failure, closeError],
			'The invalid dual-origin Pages server could not close.',
			{ cause: closeError },
		);
	}
	throw failure;
}

function validateOrigins(origins) {
	if (!origins || typeof origins !== 'object' || Array.isArray(origins)) {
		throw new TypeError('Dual-origin coverage requires both product origins.');
	}
	const admitted = Object.fromEntries(PRODUCT_IDS.map((productId) => [
		productId,
		loopbackOrigin(origins[productId], `${productId} product origin`),
	]));
	if (admitted.soundscaper === admitted.framescaper) {
		throw new Error('Dual-origin coverage requires distinct product origins.');
	}
	return Object.freeze(admitted);
}

function loopbackOrigin(value, label) {
	let url;
	try { url = new URL(value); } catch { throw new TypeError(`${label} must be an HTTP loopback origin.`); }
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new TypeError(`${label} must be an HTTP loopback origin.`);
	}
	return url.origin;
}

function assertAbsolute(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${label} path must be absolute.`);
}
