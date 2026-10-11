/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { access, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sourceMapDirectoryFor } from './build-source-map-relocation.mjs';
import { repositoryRevision } from './e2e-coverage-integrity.mjs';
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

export { BROWSER_PRODUCT_EVIDENCE } from './browser-product-site-evidence.mjs';
import { verifyBrowserProductBuildEvidence, recordBrowserProductBuildEvidence } from './browser-product-site-evidence.mjs';

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
	await verifyBrowserProductSite(siteFor(plan, 'motionscaper'));

	const source = resolve(repositoryRoot, soundscaperBuildDirectory);
	const destination = resolve(repositoryRoot, soundscaper.outputDirectory);
	if (source === destination) throw new Error('The deployable Soundscaper build cannot be localized in place.');
	await rm(destination, { recursive: true, force: true });
	await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
	await copyBuildSourceMaps(source, destination);
	await recordBrowserProductSiteEvidence(soundscaper);
	await verifyBrowserProductSite(soundscaper);
}

/** Verify build bytes against the current checkout without coupling readers to Vite. */
export function verifyBrowserProductSite(site) {
	assertSite(site);
	return verifyBrowserProductBuildEvidence({ ...site, outputDirectory: resolve(repositoryRoot, site.outputDirectory), sourceRevision: repositoryRevision(repositoryRoot) });
}

function cleanBuildEnvironment(site) {
	const environment = { ...process.env };
	for (const key of [
		'SCAPE_PRODUCT',
		'SOUNDSCAPER_SITE',
		'FRAMESCAPER_SITE',
		'MOTIONSCAPER_SITE',
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
		[`${site.productId.toUpperCase()}_SITE`]: site.origin,
		PUBLIC_TRANSFER_PEER_ORIGIN: site.peerOrigin,
	};
}

export function recordBrowserProductSiteEvidence(site) {
	return recordBrowserProductBuildEvidence({ ...site, outputDirectory: resolve(repositoryRoot, site.outputDirectory), sourceRevision: repositoryRevision(repositoryRoot) });
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
