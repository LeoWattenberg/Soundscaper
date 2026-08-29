/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { checkBuildChunks } from '../check-build-chunks.mjs';

export const BROWSER_PRODUCT_FIXTURE_ROOT = '.wrangler/browser-products';
export const BROWSER_PRODUCT_EVIDENCE = '.browser-product-build.json';

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);
const REQUIRED_PRODUCT_FILES = Object.freeze([
	'en/index.html',
	'_headers',
	'_redirects',
	'offline-shell.json',
	'service-worker.js',
]);
const repositoryRoot = resolve(import.meta.dirname, '../..');
const vite = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js');
const routeGenerator = resolve(repositoryRoot, 'scripts/generate-static-routes.mjs');
const offlineShellGenerator = resolve(repositoryRoot, 'scripts/generate-offline-application-shell.mjs');

/**
 * The two production-shaped origins used by the ordinary browser suite.
 *
 * Soundscaper keeps PLAYWRIGHT_PORT for compatibility with focused local runs.
 * Framescaper defaults to the following port, but can be moved independently
 * when two neighboring ports are not available.
 */
export function ordinaryBrowserProductSitePlan(environment = process.env) {
	const soundscaperPort = browserPort(environment.PLAYWRIGHT_PORT, 4322, 'PLAYWRIGHT_PORT');
	const framescaperPort = browserPort(
		environment.PLAYWRIGHT_FRAMESCAPER_PORT,
		soundscaperPort + 1,
		'PLAYWRIGHT_FRAMESCAPER_PORT',
	);
	if (soundscaperPort === framescaperPort) {
		throw new Error('The Soundscaper and Framescaper Playwright origins must use different ports.');
	}
	return productSitePlan({
		fixtureRoot: BROWSER_PRODUCT_FIXTURE_ROOT,
		soundscaperOrigin: `http://127.0.0.1:${String(soundscaperPort)}`,
		framescaperOrigin: `http://127.0.0.1:${String(framescaperPort)}`,
	});
}

/** A Vite production-preview descriptor safe to put directly in Playwright config. */
export function vitePreviewServer(site, readinessPath = '/en/') {
	assertSite(site);
	if (typeof readinessPath !== 'string' || !readinessPath.startsWith('/')) {
		throw new TypeError('A browser-product readiness path must be absolute.');
	}
	const port = new URL(site.origin).port;
	return {
		command: 'node node_modules/vite/bin/vite.js preview '
			+ `--outDir ${site.outputDirectory} --host 127.0.0.1 --port ${port} `
			+ '--strictPort --logLevel error',
		url: `${site.origin}${readinessPath}`,
		reuseExistingServer: false,
		timeout: 120_000,
	};
}

/** Build and verify one product without changing the deployable Soundscaper dist/. */
export async function buildBrowserProductSite(site) {
	assertSite(site);
	const outputDirectory = resolve(repositoryRoot, site.outputDirectory);
	const environment = cleanBuildEnvironment(site);
	await run(process.execPath, [
		vite,
		'build',
		'--outDir', outputDirectory,
		'--emptyOutDir',
	], environment, `build the ${site.productId} browser-test site`);
	await run(process.execPath, [
		routeGenerator,
		outputDirectory,
	], environment, `generate the ${site.productId} Pages routes`);
	await run(process.execPath, [
		offlineShellGenerator,
		outputDirectory,
	], environment, `generate the ${site.productId} offline shell`);
	checkBuildChunks(outputDirectory);
	await recordBrowserProductSiteEvidence(site);
	await verifyBrowserProductSite(site);
}

/**
 * Authenticate the downloaded Framescaper artifact, then make a verified,
 * disposable Soundscaper copy without changing either production artifact.
 */
export async function prepareOrdinaryBrowserProductSites(
	plan = ordinaryBrowserProductSitePlan(),
	{ soundscaperBuildDirectory = 'dist' } = {},
) {
	assertPlan(plan);
	const soundscaper = siteFor(plan, 'soundscaper');
	const framescaper = siteFor(plan, 'framescaper');
	await verifyBrowserProductSite(framescaper);

	const source = resolve(repositoryRoot, soundscaperBuildDirectory);
	const destination = resolve(repositoryRoot, soundscaper.outputDirectory);
	if (source === destination) throw new Error('The deployable Soundscaper build cannot be localized in place.');
	await rm(destination, { recursive: true, force: true });
	await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
	await recordBrowserProductSiteEvidence(soundscaper);
	await verifyBrowserProductSite(soundscaper);
}

/** Verify the product identity and every digest recorded by the build step. */
export async function verifyBrowserProductSite(site) {
	assertSite(site);
	const outputDirectory = resolve(repositoryRoot, site.outputDirectory);
	const evidencePath = resolve(outputDirectory, BROWSER_PRODUCT_EVIDENCE);
	let evidence;
	try {
		evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`The ${site.productId} browser site has no readable verification evidence at ${evidencePath}.`,
			{ cause: error },
		);
	}
	if (evidence.schemaVersion !== 1
		|| evidence.productId !== site.productId
		|| evidence.origin !== site.origin) {
		throw new Error(`The ${site.productId} browser-site verification evidence names the wrong build.`);
	}
	const required = requiredProductFiles(site.productId);
	const actualFiles = await browserProductFiles(outputDirectory);
	if (required.some((relativePath) => !actualFiles.includes(relativePath))
		|| JSON.stringify(Object.keys(evidence.files ?? {}).sort()) !== JSON.stringify(actualFiles)) {
		throw new Error(`The ${site.productId} browser-site verification evidence has an incomplete file inventory.`);
	}
	for (const relativePath of actualFiles) {
		const bytes = await readFile(resolve(outputDirectory, relativePath));
		const record = evidence.files[relativePath];
		if (record?.byteLength !== bytes.byteLength || record.sha256 !== sha256(bytes)) {
			throw new Error(`The verified ${site.productId} browser file changed: ${relativePath}.`);
		}
	}
	const document = await readFile(resolve(outputDirectory, 'en/index.html'), 'utf8');
	if (!document.includes(`data-product="${site.productId}"`)) {
		throw new Error(`The verified ${site.productId} browser site serves the wrong product document.`);
	}
	return evidence;
}

function productSitePlan({ fixtureRoot, soundscaperOrigin, framescaperOrigin }) {
	const origins = Object.freeze({
		soundscaper: browserOrigin(soundscaperOrigin, 'Soundscaper browser origin'),
		framescaper: browserOrigin(framescaperOrigin, 'Framescaper browser origin'),
	});
	const sites = PRODUCT_IDS.map((productId) => Object.freeze({
		productId,
		origin: origins[productId],
		peerOrigin: origins[productId === 'soundscaper' ? 'framescaper' : 'soundscaper'],
		outputDirectory: `${fixtureRoot}/${productId}`,
	}));
	return Object.freeze({ fixtureRoot, sites: Object.freeze(sites) });
}

function browserPort(value, fallback, variable) {
	const port = value === undefined || value === '' ? fallback : Number(value);
	if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
		throw new Error(`${variable} must be an integer port from 1024 through 65535.`);
	}
	return port;
}

function browserOrigin(value, label) {
	const url = new URL(value);
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
		|| !url.port || url.pathname !== '/' || url.search || url.hash) {
		throw new Error(`${label} must be an http://127.0.0.1:<port> origin.`);
	}
	return url.origin;
}

function assertPlan(plan) {
	if (!plan || !Array.isArray(plan.sites) || plan.sites.length !== PRODUCT_IDS.length) {
		throw new TypeError('A browser-product site plan must contain both products.');
	}
	for (const site of plan.sites) assertSite(site);
}

function assertSite(site) {
	if (!site || !PRODUCT_IDS.includes(site.productId)) {
		throw new TypeError('A browser-product site descriptor has an invalid product id.');
	}
	browserOrigin(site.origin, `${site.productId} browser origin`);
	browserOrigin(site.peerOrigin, `${site.productId} peer browser origin`);
	for (const value of [site.outputDirectory]) {
		if (typeof value !== 'string'
			|| !/^\.wrangler\/[A-Za-z0-9_./-]+$/u.test(value)
			|| value.split('/').includes('..')) {
			throw new TypeError(`The ${site.productId} browser fixture path is invalid.`);
		}
	}
}

function siteFor(plan, productId) {
	const site = plan.sites.find((candidate) => candidate.productId === productId);
	if (!site) throw new Error(`The browser-product site plan omits ${productId}.`);
	return site;
}

function cleanBuildEnvironment(site) {
	const environment = { ...process.env };
	for (const key of [
		'SCAPE_PRODUCT',
		'SOUNDSCAPER_SITE',
		'FRAMESCAPER_SITE',
		'PUBLIC_TRANSFER_PEER_ORIGIN',
	]) delete environment[key];
	return {
		...environment,
		SCAPE_PRODUCT: site.productId,
		[site.productId === 'soundscaper' ? 'SOUNDSCAPER_SITE' : 'FRAMESCAPER_SITE']: site.origin,
		PUBLIC_TRANSFER_PEER_ORIGIN: site.peerOrigin,
	};
}

export async function recordBrowserProductSiteEvidence(site) {
	const outputDirectory = resolve(repositoryRoot, site.outputDirectory);
	const files = {};
	for (const relativePath of await browserProductFiles(outputDirectory)) {
		const bytes = await readFile(resolve(outputDirectory, relativePath));
		files[relativePath] = Object.freeze({ byteLength: bytes.byteLength, sha256: sha256(bytes) });
	}
	const evidence = {
		schemaVersion: 1,
		productId: site.productId,
		origin: site.origin,
		files,
	};
	await writeFile(
		resolve(outputDirectory, BROWSER_PRODUCT_EVIDENCE),
		`${JSON.stringify(evidence, null, 2)}\n`,
		'utf8',
	);
}

function requiredProductFiles(productId) {
	return Object.freeze([
		...REQUIRED_PRODUCT_FILES,
		`manifest-${productId}.webmanifest`,
	]);
}

async function browserProductFiles(outputDirectory, relativeDirectory = '') {
	const files = [];
	const directory = resolve(outputDirectory, relativeDirectory);
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (relativePath === BROWSER_PRODUCT_EVIDENCE) continue;
		if (entry.isDirectory()) {
			files.push(...await browserProductFiles(outputDirectory, relativePath));
		} else if (entry.isFile()) {
			files.push(relativePath);
		} else {
			throw new Error(`The browser-product site contains an unsupported entry: ${relativePath}.`);
		}
	}
	return files.sort();
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function run(command, arguments_, environment, description) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, arguments_, {
			cwd: repositoryRoot,
			env: environment,
			stdio: 'inherit',
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolveRun();
				return;
			}
			rejectRun(new Error(
				`Could not ${description}: ${signal ? `terminated by ${signal}` : `exit ${String(code)}`}.`,
			));
		});
	});
}
