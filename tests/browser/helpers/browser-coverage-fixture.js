/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from '@playwright/test';

import {
	collectsBrowserCoverage,
	createBrowserCoverageCollector,
} from '../../../scripts/lib/browser-coverage-profile.mjs';
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';

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

export const test = base.extend({
	context: async ({ context, browserName }, use, testInfo) => {
		if (!collectsBrowserCoverage(browserName)) {
			await use(context);
			return;
		}
		const collector = createBrowserCoverageCollector({
			browserName,
			scripts,
			sites: browserProductSites(),
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
	page: async ({ page }, use) => {
		// Playwright opened this page while the context fixture was still setting
		// up, so the recorder may still be starting. Settling here is what keeps a
		// test's first navigation inside the measured window.
		await collectors.get(page.context())?.settle();
		await use(page);
	},
});

export { expect } from '@playwright/test';
