#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { verifyFfmpegRuntimeManifest } from './lib/ffmpeg-runtime-manifest.mjs';
import {
	preflightPagesDeployment,
	verifyLivePagesCachePolicy,
} from './lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from './lib/product-web-routing.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

try {
	// One deployment serves one product, so the gate audits the origin this
	// build is bound for — never soundscaper.org by assumption.
	const routing = webBuildRouting();
	const origin = routing.site.origin;
	const release = await verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'runtime-publication' });
	const result = await preflightPagesDeployment({ release, origin });
	const audit = JSON.parse(await readFile(resolve(repositoryRoot, 'dist/offline-shell.json'), 'utf8'));
	const assetPath = audit.assets?.find(({ url }) => /^\/assets\/[\w.-]+\.(?:css|js)$/u.test(url))?.url;
	const pages = await verifyLivePagesCachePolicy({ routing, origin, assetPath });
	console.log(`Verified ${String(result.verifiedObjectCount)} live FFmpeg objects for Pages deploy (${result.manifestSha256}).`);
	console.log(`Verified ${String(pages.verifiedRouteCount)} live ${routing.productId} routes on ${origin}.`);
} catch (error) {
	console.error(`Pages deploy preflight failed: ${error.message}`);
	process.exitCode = 1;
}
