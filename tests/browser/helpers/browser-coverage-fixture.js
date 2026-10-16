/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from '@playwright/test';

import {
	collectsBrowserCoverage,
	createBrowserCoverageCollector,
} from '../../../scripts/lib/browser-coverage-profile.mjs';
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';
import { resolveBrowserProductBaseURL, scopedBrowserCoverageEnvironment } from './browser-product-base-url.ts';
import { withTrackedBrowserContext } from './tracked-browser-context.ts';
import { collectFailureClientDiagnostics } from './failure-client-diagnostics.js';

// Every spec imports its `test` from `audio-editor-test-fixtures.js`, which
// imports it from here, so collection is a property of the suite rather than
// something each spec opts into. With SCAPE_BROWSER_COVERAGE unset — every
// ordinary run, and every engine that is not Chromium — no collector is built
// and both fixtures below hand their subject straight through.

/** One resolved-map cache and one written-map ledger per Playwright worker. */
const scripts = new Map();
const writtenSourceMaps = new Set();
const collectors = new WeakMap();

let sitePlan = null;

function browserProductSites() {
	// Resolved on first use, not at import: a configuration with origins of its
	// own (the dual-origin suite) must not fail to load because this plan cannot
	// be built, and an ordinary run pays nothing for a plan it never reads.
	sitePlan ??= ordinaryBrowserProductSitePlan();
	return sitePlan.sites;
}

/**
 * Own an additional isolated recipient and its independent coverage recorder.
 * @template Result
 * @param {{ browser: import('@playwright/test').Browser, launchOptions?: import('@playwright/test').LaunchOptions, options: import('@playwright/test').BrowserContextOptions, browserCoverage?: boolean, browserCoverageSites?: Array<{origin: string, outputDirectory: string, productId: 'soundscaper' | 'framescaper' | 'motionscaper'}> | null, title: string }} options
 * @param {(tracked: {context: import('@playwright/test').BrowserContext, newPage(): Promise<import('@playwright/test').Page>}) => Promise<Result>} work
 */
export function withBrowserCoverageContext({ browser, launchOptions, options, browserCoverage = true, browserCoverageSites = null, title }, work) {
	const browserName = browser.browserType().name();
	const measured = browserCoverage && collectsBrowserCoverage(browserName);
	/** @type {import('@playwright/test').Browser | null} */
	let ownedBrowser = null;
	return withTrackedBrowserContext({
		async createContext() {
			// Worker coverage owns the whole browser CDP target. A second measured
			// context needs its own browser, not a competing recorder on that target.
			if (measured) ownedBrowser = await browser.browserType().launch(launchOptions);
			return (ownedBrowser ?? browser).newContext(options);
		},
		createCollector() {
			if (!measured) return null;
			const collector = createBrowserCoverageCollector({ browserName, scripts, environment: scopedBrowserCoverageEnvironment(browserCoverageSites), sites: browserCoverageSites ?? browserProductSites() });
			return { attach: collector.attach, settle: collector.settle, collect: () => collector.collect(title, writtenSourceMaps) };
		},
		async release() { await ownedBrowser?.close(); },
	}, work);
}

/** @typedef {{browserCoverage: boolean, browserCoverageSites: Array<{origin: string, outputDirectory: string, productId: 'soundscaper' | 'framescaper' | 'motionscaper'}> | null}} BrowserCoverageOptions */
/** @type {import('@playwright/test').TestType<import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions & BrowserCoverageOptions, import('@playwright/test').PlaywrightWorkerArgs & import('@playwright/test').PlaywrightWorkerOptions>} */
export const test = base.extend({
	// A spec whose budget is bound by realtime work can switch collection off
	// with `test.use({ browserCoverage: false })`: even precise block coverage
	// slows a page, and a test that races a render clock is not the place to
	// pay for it.
	browserCoverage: [true, { option: true }],
	// Custom product fixtures retain their own built roots and ordinary source URLs.
	browserCoverageSites: [null, { option: true }],
	baseURL: async ({ baseURL, browserCoverageSites }, use, testInfo) => {
		await use(resolveBrowserProductBaseURL({
			file: testInfo.file, baseURL, customSites: browserCoverageSites !== null,
		}));
	},
	context: async ({ context, browserName, browserCoverage, browserCoverageSites }, use, testInfo) => {
		if (!browserCoverage || !collectsBrowserCoverage(browserName)) {
			await use(context);
			return;
		}
		const collector = createBrowserCoverageCollector({
			browserName,
			environment: scopedBrowserCoverageEnvironment(browserCoverageSites),
			scripts,
			sites: browserCoverageSites ?? browserProductSites(),
		});
		collectors.set(context, collector);
		// Popups and reciprocal-origin windows open their own pages, so the whole
		// context is instrumented rather than the one page the test starts with.
		collector.attach(context);
		try {
			await use(context);
		} finally {
			await collector.collect(testInfo.titlePath.join(' '), writtenSourceMaps);
		}
	},
	page: async ({ page, browserName }, use, testInfo) => {
		// Playwright opened this page while the context fixture was still setting
		// up, so the recorder may still be starting. Settling here is what keeps a
		// test's first navigation inside the measured window.
		await collectors.get(page.context())?.settle();
		const finishDiagnostics = collectFailureClientDiagnostics(page, browserName);
		try { await use(page); }
		finally { await finishDiagnostics(testInfo); }
	},
});

export { expect } from '@playwright/test';
