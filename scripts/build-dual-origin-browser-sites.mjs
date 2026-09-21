#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import { buildBrowserProductSite } from './lib/browser-product-test-sites.mjs';

const sites = Object.freeze([
	Object.freeze({
		productId: 'soundscaper',
		origin: 'http://127.0.0.1:4332',
		peerOrigin: 'http://127.0.0.1:4333',
		outputDirectory: '.wrangler/dual-origin-browser/soundscaper',
	}),
	Object.freeze({
		productId: 'framescaper',
		origin: 'http://127.0.0.1:4333',
		peerOrigin: 'http://127.0.0.1:4332',
		outputDirectory: '.wrangler/dual-origin-browser/framescaper',
	}),
]);

// Use the authenticated browser-product builder so the reciprocal pair carries
// hidden source maps, Pages routes, an offline shell, chunk checks, and exact
// file/source-map evidence. It is also the one browser denominator staged into
// nightly-with-tests, so ordinary and reciprocal profiles cannot name different
// bytes with the same portable coverage URL.
for (const site of sites) await buildBrowserProductSite(site);
