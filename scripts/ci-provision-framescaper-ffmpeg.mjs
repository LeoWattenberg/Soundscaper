#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import {
	runFramescaperFfmpegCiProvisioning,
} from './lib/framescaper-ffmpeg-ci.mjs';

if (process.argv.length !== 2) {
	throw new TypeError('Framescaper FFmpeg CI provisioning accepts no arguments.');
}
await runFramescaperFfmpegCiProvisioning({
	repositoryRoot: resolve(import.meta.dirname, '..'),
	runnerTemp: process.env.RUNNER_TEMP,
	githubEnvironmentPath: process.env.GITHUB_ENV,
});
