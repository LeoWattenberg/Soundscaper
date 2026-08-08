#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FFMPEG_RUNTIME_MANIFEST_PATH, repinFfmpegRuntimeEvidence } from './lib/ffmpeg-runtime-manifest.mjs';

const checkOnly = process.argv.includes('--check');
try {
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const result = await repinFfmpegRuntimeEvidence({ repositoryRoot });
	if (!result.changed) {
		console.log(`FFmpeg runtime evidence pins are current (${result.refreshed.length} pinned files).`);
	} else if (checkOnly) {
		console.error('FFmpeg runtime evidence pins are stale; run `node scripts/repin-runtime-evidence.mjs` and commit the manifest.');
		process.exitCode = 1;
	} else {
		await writeFile(resolve(repositoryRoot, FFMPEG_RUNTIME_MANIFEST_PATH), result.manifestText);
		for (const pin of result.refreshed) {
			console.log(`${pin.path}: ${pin.byteLength} bytes, sha256 ${pin.sha256}`);
		}
		console.log(`Repinned ${result.refreshed.length} evidence files and the review payload digest in ${FFMPEG_RUNTIME_MANIFEST_PATH}.`);
	}
} catch (error) {
	console.error(`FFmpeg runtime evidence repin failed: ${error.message}`);
	process.exitCode = 1;
}
