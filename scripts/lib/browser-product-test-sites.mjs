/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sourceMapDirectoryFor } from './build-source-map-relocation.mjs';
import {
	assertPlan,
	assertSite,
	ordinaryBrowserProductSitePlan,
	siteFor,
} from './browser-product-site-plan.mjs';
import { checkBuildChunks } from '../check-build-chunks.mjs';

// Re-exported so the builder stays the one import a caller needs for a whole
// browser-site workflow, plan included.
export {
	BROWSER_PRODUCT_FIXTURE_ROOT,
	ordinaryBrowserProductSitePlan,
	vitePreviewServer,
} from './browser-product-site-plan.mjs';

export const BROWSER_PRODUCT_EVIDENCE = '.browser-product-build.json';

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
	await copyBuildSourceMaps(source, destination);
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
		// Hidden maps, written beside the site rather than inside it, are what
		// lets the Chromium coverage run read a bundled chunk back onto `src/`.
		// They cost a little build time and change none of the built bytes, so
		// the test sites always carry them.
		SCAPE_BUILD_SOURCE_MAPS: '1',
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

/**
 * Carry a copied build's maps along with it.
 *
 * The Soundscaper test site is a copy of the deployable build, and CI downloads
 * that build's maps separately, so the copy only moves maps that are actually
 * there — and never clears maps another step has already put in place.
 */
async function copyBuildSourceMaps(source, destination) {
	const from = sourceMapDirectoryFor(source);
	try {
		await access(from);
	} catch {
		return;
	}
	const to = sourceMapDirectoryFor(destination);
	await rm(to, { recursive: true, force: true });
	await cp(from, to, { recursive: true, force: true, errorOnExist: false });
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
