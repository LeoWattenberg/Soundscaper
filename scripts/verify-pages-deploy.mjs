#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { verifyLivePagesCachePolicy } from './lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from './lib/product-web-routing.mjs';

try {
	const routing = webBuildRouting();
	const origin = process.env.SCAPE_DEPLOY_AUDIT_ORIGIN?.trim() || routing.site.origin;
	const pages = await verifyLivePagesCachePolicy({ routing, origin, includeRetired: true });
	console.log(
		`Verified ${String(pages.verifiedRouteCount)} deployed ${routing.productId} routes on ${origin}`
		+ ` (immutable-asset rule sampled on ${pages.assetPath}).`,
	);
} catch (error) {
	console.error(`Pages post-deploy verification failed: ${error.message}`);
	process.exitCode = 1;
}
