#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { publishFfmpegRuntime } from './lib/ffmpeg-runtime-publisher.mjs';

export async function main() {
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const result = await publishFfmpegRuntime({ repositoryRoot });
	console.log(`Published ${result.objectCount} policy-verified FFmpeg runtime objects (${result.manifestSha256}).`);
}

function isMainModule() {
	return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMainModule()) {
	main().catch((error) => {
		console.error(`FFmpeg runtime publication failed: ${error.message}`);
		process.exitCode = 1;
	});
}
