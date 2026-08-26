#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { verifyFfmpegRuntimeManifest } from './lib/ffmpeg-runtime-manifest.mjs';
import { preflightPagesDeployment } from './lib/pages-deploy-preflight.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

try {
	const release = await verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'runtime-publication' });
	const result = await preflightPagesDeployment({ release });
	console.log(`Verified ${String(result.verifiedObjectCount)} live FFmpeg objects for Pages deploy (${result.manifestSha256}).`);
} catch (error) {
	console.error(`Pages deploy preflight failed: ${error.message}`);
	process.exitCode = 1;
}
