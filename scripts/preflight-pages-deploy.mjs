#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitPagesColdStart,
	verifyLivePagesCachePolicy,
} from './lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from './lib/product-web-routing.mjs';

try {
	// One deployment serves one product, so the gate audits the origin this
	// build is bound for — never soundscaper.org by assumption.
	//
	// The canonical host and the host under audit are not always the same, and
	// conflating them fails a deploy for the wrong reason. A product's canonical
	// host is where its documents say they live; the audit host is where the
	// PREVIOUS deployment of this project is actually answering. Those diverge
	// while a custom domain has not been pointed at its project yet — during
	// which the canonical host may answer with another product entirely, which
	// is worse than not answering at all, because the audit would then pass or
	// fail on a stranger's content. Name the audit host explicitly in that
	// window; the canonical host stays whatever the product's routing says.
	const routing = webBuildRouting();
	const origin = process.env.SCAPE_DEPLOY_AUDIT_ORIGIN?.trim() || routing.site.origin;
	// Declared, never inferred: an origin that answers is audited in full even
	// when this is set, so the declaration can only excuse an origin that has
	// no deployment at all.
	const coldStart = admitPagesColdStart(process.env);
	// Retired paths describe the build being deployed, not the predecessor this
	// pre-deploy gate is reading. They are verified after deployment by the same
	// fail-closed verifier; stable live routes remain a pre-deploy requirement.
	const pages = await verifyLivePagesCachePolicy({ routing, origin, coldStart, includeRetired: false });
	console.log(pages.coldStart
		? `Nothing answers ${origin} yet, so there is no live ${routing.productId} deployment to audit; `
			+ 'this build is that origin\'s first.'
		: `Verified ${String(pages.verifiedRouteCount)} live ${routing.productId} routes on ${origin} `
			+ `(immutable-asset rule sampled on ${pages.assetPath}).`);
} catch (error) {
	console.error(`Pages deploy preflight failed: ${error.message}`);
	process.exitCode = 1;
}
