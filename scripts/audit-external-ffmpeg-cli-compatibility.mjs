#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { executeExternalFfmpegCliCompatibilityLab } from './lib/external-ffmpeg-cli-compatibility-lab.mjs';

if (!process.argv.includes('--execute-external-binaries')) {
	throw new Error('Pass --execute-external-binaries to run the digest-pinned Linux x64 FFmpeg witnesses.');
}

const report = await executeExternalFfmpegCliCompatibilityLab();
console.log(JSON.stringify(report, null, 2));
