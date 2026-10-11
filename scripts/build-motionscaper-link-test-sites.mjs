#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { buildBrowserProductSite } from './lib/browser-product-test-sites.mjs';
const frameOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_LINK_FRAME_PORT || '4345'}`;
const motionOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_LINK_MOTION_PORT || '4346'}`;
for (const site of [
	{ productId: 'framescaper', origin: frameOrigin, peerOrigin: motionOrigin, outputDirectory: '.wrangler/motionscaper-links/framescaper' },
	{ productId: 'motionscaper', origin: motionOrigin, peerOrigin: frameOrigin, outputDirectory: '.wrangler/motionscaper-links/motionscaper' },
]) {
	process.env.SCAPE_FRAMESCAPER_LINE = site.productId === 'framescaper' ? 'successor' : 'baseline';
	process.env.PUBLIC_MOTION_LINK_PEER_ORIGIN = site.peerOrigin;
	await buildBrowserProductSite(site);
}
