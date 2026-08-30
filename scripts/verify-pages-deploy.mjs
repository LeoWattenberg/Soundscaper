#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';

import { verifyPublishedPagesArtifactIdentity } from './lib/pages-deploy-artifact-binding.mjs';
import { verifyPublishedPagesCachePolicy } from './lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from './lib/product-web-routing.mjs';

try {
	const routing = webBuildRouting();
	const origin = process.env.SCAPE_DEPLOY_AUDIT_ORIGIN?.trim() || routing.site.origin;
	const expectedArtifactPath = process.env.SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL?.trim();
	const evidencePath = process.env.SCAPE_DEPLOY_IDENTITY_EVIDENCE?.trim();
	if (evidencePath && !expectedArtifactPath) {
		throw new Error('SCAPE_DEPLOY_IDENTITY_EVIDENCE requires SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL.');
	}
	const identity = expectedArtifactPath
		? await verifyPublishedPagesArtifactIdentity({ expectedArtifactPath, origin }, {
			onRetry: ({ attempt, error, intervalMs }) => console.log(
				`Attempt ${String(attempt)} did not read the admitted offline shell (${error.message});`
				+ ` waiting ${String(intervalMs / 1_000)}s for propagation.`,
			),
		})
		: null;
	const pages = await verifyPublishedPagesCachePolicy({ routing, origin, includeRetired: true }, {
		onRetry: ({ attempt, error, intervalMs }) => console.log(
			`Attempt ${String(attempt)} read the previous deployment (${error.message});`
			+ ` waiting ${String(intervalMs / 1_000)}s for propagation.`,
		),
	});
	console.log(
		`Verified ${String(pages.verifiedRouteCount)} deployed ${routing.productId} routes on ${origin}`
		+ ` (immutable-asset rule sampled on ${pages.assetPath}).`,
	);
	if (identity && evidencePath) {
		await writeFile(evidencePath, `${JSON.stringify({
			...identity,
			productId: routing.productId,
			verifiedRouteCount: pages.verifiedRouteCount,
			immutableAssetPath: pages.assetPath,
		}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
		console.log(`Recorded exact Pages deployment identity in ${evidencePath}.`);
	}
} catch (error) {
	console.error(`Pages post-deploy verification failed: ${error.message}`);
	process.exitCode = 1;
}
