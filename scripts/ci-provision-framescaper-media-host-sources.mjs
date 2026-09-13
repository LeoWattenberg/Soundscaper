#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** GitHub-hosted entry point for the media host's exact linked source set. */

import { resolve } from 'node:path';

import {
	runFramescaperMediaHostExternalSourceCiProvisioning,
} from './lib/framescaper-media-host-external-source-ci.mjs';

if (process.argv.length !== 2) {
	throw new TypeError('Framescaper media-host source provisioning accepts no arguments.');
}
const result = await runFramescaperMediaHostExternalSourceCiProvisioning({
	repositoryRoot: resolve(process.cwd()),
	runnerTemp: process.env.RUNNER_TEMP,
	githubEnvironmentPath: process.env.GITHUB_ENV,
});
process.stdout.write(`Provisioned ${String(result.sources.length)} exact media source trees.\n`);
