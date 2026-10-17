/* SPDX-License-Identifier: AGPL-3.0-only */

// The shape of a browser-test run: which product answers on which loopback
// origin, and which directory that origin is served out of. It is deliberately
// free of the build — Playwright's configuration, the site builder, and the
// Chromium coverage collector all need the same answer, and only one of them
// should have to carry Vite and the build guards to get it.

export const BROWSER_PRODUCT_FIXTURE_ROOT = '.wrangler/browser-products';

export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper', 'motionscaper']);
const TRANSFER_PEERS = Object.freeze({
	soundscaper: 'framescaper', framescaper: 'soundscaper', motionscaper: 'framescaper',
});

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
	const motionscaperPort = browserPort(
		environment.PLAYWRIGHT_MOTIONSCAPER_PORT,
		soundscaperPort + 2,
		'PLAYWRIGHT_MOTIONSCAPER_PORT',
	);
	if (new Set([soundscaperPort, framescaperPort, motionscaperPort]).size !== PRODUCT_IDS.length) {
		throw new Error('The editor Playwright origins must use different ports.');
	}
	return productSitePlan({
		fixtureRoot: BROWSER_PRODUCT_FIXTURE_ROOT,
		soundscaperOrigin: `http://127.0.0.1:${String(soundscaperPort)}`,
		framescaperOrigin: `http://127.0.0.1:${String(framescaperPort)}`,
		motionscaperOrigin: `http://127.0.0.1:${String(motionscaperPort)}`,
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

function productSitePlan({ fixtureRoot, soundscaperOrigin, framescaperOrigin, motionscaperOrigin }) {
	const origins = Object.freeze({
		soundscaper: browserOrigin(soundscaperOrigin, 'Soundscaper browser origin'),
		framescaper: browserOrigin(framescaperOrigin, 'Framescaper browser origin'),
		motionscaper: browserOrigin(motionscaperOrigin, 'Motionscaper browser origin'),
	});
	const sites = PRODUCT_IDS.map((productId) => Object.freeze({
		productId,
		origin: origins[productId],
		peerOrigin: origins[TRANSFER_PEERS[productId]],
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

/** Reject anything that is not a complete, isolated editor-product plan. */
export function assertPlan(plan) {
	if (!plan || !Array.isArray(plan.sites) || plan.sites.length !== PRODUCT_IDS.length) {
		throw new TypeError('A browser-product site plan must contain every product exactly once.');
	}
	for (const site of plan.sites) assertSite(site);
	if (new Set(plan.sites.map((site) => site.productId)).size !== PRODUCT_IDS.length) {
		throw new TypeError('A browser-product site plan must contain every product exactly once.');
	}
	if (new Set(plan.sites.map((site) => site.origin)).size !== PRODUCT_IDS.length) {
		throw new TypeError('Browser-product sites require distinct origins.');
	}
}

/** Reject anything that is not a valid single-product descriptor. */
export function assertSite(site) {
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

/** The one descriptor a plan holds for a product. */
export function siteFor(plan, productId) {
	const site = plan.sites.find((candidate) => candidate.productId === productId);
	if (!site) throw new Error(`The browser-product site plan omits ${productId}.`);
	return site;
}
