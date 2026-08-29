#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	buildBrowserProductSite,
	ordinaryBrowserProductSitePlan,
} from './lib/browser-product-test-sites.mjs';

const productId = process.argv[2];
const plan = ordinaryBrowserProductSitePlan();
const site = plan.sites.find((candidate) => candidate.productId === productId);
if (!site) {
	throw new Error('build-browser-product-site requires soundscaper or framescaper.');
}
await buildBrowserProductSite(site);
