#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DUAL_ORIGIN_BROWSER_SITES } from './build-dual-origin-browser-sites.mjs';
import { ordinaryBrowserProductSitePlan } from './lib/browser-product-site-plan.mjs';
import { verifyBrowserProductSite } from './lib/browser-product-test-sites.mjs';

export const NIGHTLY_BROWSER_SITES = Object.freeze([
	...ordinaryBrowserProductSitePlan({}).sites,
	...DUAL_ORIGIN_BROWSER_SITES,
]);

export async function verifyNightlyBrowserSites(sites = NIGHTLY_BROWSER_SITES) {
	for (const site of sites) await verifyBrowserProductSite(site);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await verifyNightlyBrowserSites();
}
