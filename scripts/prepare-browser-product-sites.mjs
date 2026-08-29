#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ordinaryBrowserProductSitePlan,
	prepareOrdinaryBrowserProductSites,
	verifyBrowserProductSite,
} from './lib/browser-product-test-sites.mjs';

// Named imports are deliberately explicit: the Playwright configuration test
// holds this entry point to authenticating the downloaded artifact before it
// becomes a browser-test server root.
void verifyBrowserProductSite;

await prepareOrdinaryBrowserProductSites(ordinaryBrowserProductSitePlan());
