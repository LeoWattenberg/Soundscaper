#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { configureRuntimeCacheRules } from './lib/cloudflare-runtime-cache.mjs';
import { verifyFfmpegRuntimeManifest } from './lib/ffmpeg-runtime-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

try {
	const release = await verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'runtime-publication' });
	const result = await configureRuntimeCacheRules({ policy: release.publicPolicy });
	console.log(`${result.action === 'created' ? 'Created' : 'Updated'} ${String(result.ruleCount)} Cloudflare runtime cache rules.`);
} catch (error) {
	console.error(`FFmpeg runtime cache configuration failed: ${error.message}`);
	process.exitCode = 1;
}
