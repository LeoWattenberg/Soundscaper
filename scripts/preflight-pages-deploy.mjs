#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { verifyFfmpegRuntimeManifest } from './lib/ffmpeg-runtime-manifest.mjs';
import {
	admitPagesColdStart,
	preflightPagesDeployment,
	verifyLivePagesCachePolicy,
} from './lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from './lib/product-web-routing.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

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
	// The browser FFmpeg runtime is not published, and cannot be until three
	// licensing gates clear — none of which any deploy can influence. Failing
	// the gate on that would be honest and would also block every deploy
	// indefinitely, so the unpublished state is reported rather than fatal
	// WHILE the manifest itself declares publication blocked. The moment that
	// authorization reads approved, the live objects must exist and their
	// absence is fatal again: this branch can only excuse a state the
	// repository has already recorded, never one discovered at the origin.
	const publication = await readRuntimePublicationAuthorization(repositoryRoot);
	const result = publication.status === 'blocked'
		? null
		: await preflightPagesDeployment({
			release: await verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'runtime-publication' }),
			origin,
		});
	const pages = await verifyLivePagesCachePolicy({ routing, origin, coldStart });
	console.log(result === null
		? 'FFmpeg runtime publication is blocked by '
			+ `${publication.blockedBy.join(', ')}, so no live runtime objects were audited. `
			+ 'Compressed and video export do not work on this origin until those clear.'
		: `Verified ${String(result.verifiedObjectCount)} live FFmpeg objects for Pages deploy (${result.manifestSha256}).`);
	console.log(pages.coldStart
		? `Nothing answers ${origin} yet, so there is no live ${routing.productId} deployment to audit; `
			+ 'this build is that origin\'s first.'
		: `Verified ${String(pages.verifiedRouteCount)} live ${routing.productId} routes on ${origin} `
			+ `(immutable-asset rule sampled on ${pages.assetPath}).`);
} catch (error) {
	console.error(`Pages deploy preflight failed: ${error.message}`);
	process.exitCode = 1;
}

/**
 * Read the manifest's own record of whether the browser FFmpeg runtime may be
 * published. This reads the declaration rather than re-deriving it from the
 * licensing matrix: `verifyFfmpegRuntimeManifest` already proves the two agree,
 * and it is the one that must stay authoritative.
 */
async function readRuntimePublicationAuthorization(root) {
	const path = resolve(root, 'config/ffmpeg-runtime-manifest.json');
	const manifest = JSON.parse(await readFile(path, 'utf8'));
	const authorization = manifest?.authorizations?.runtimePublication;
	if (!authorization || (authorization.status !== 'approved' && authorization.status !== 'blocked')) {
		throw new Error('config/ffmpeg-runtime-manifest.json has no admissible runtimePublication authorization.');
	}
	const blockedBy = Object.freeze([...authorization.blockedBy ?? []]);
	if (authorization.status === 'blocked' && blockedBy.length === 0) {
		throw new Error('runtimePublication is blocked but names no gate; the manifest cannot be trusted.');
	}
	return Object.freeze({ status: authorization.status, blockedBy });
}
