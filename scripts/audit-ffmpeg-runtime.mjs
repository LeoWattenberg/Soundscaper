#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { verifyFfmpegRuntimeManifest } from './lib/ffmpeg-runtime-manifest.mjs';

try {
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: resolve(import.meta.dirname, '..'),
		purpose: 'audit',
	});
	console.log(`Verified policy-bound FFmpeg runtime ${release.manifest.id} (${release.manifestSha256}).`);
} catch (error) {
	console.error(`FFmpeg runtime audit failed: ${error.message}`);
	process.exitCode = 1;
}
