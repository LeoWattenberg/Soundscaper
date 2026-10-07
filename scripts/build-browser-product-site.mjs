#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	buildBrowserProductSite,
} from './lib/browser-product-test-sites.mjs';
import { browserProductSiteForBuild } from './lib/browser-product-site-plan.mjs';

const productId = process.argv[2];
const site = browserProductSiteForBuild(productId);
await buildBrowserProductSite(site);
