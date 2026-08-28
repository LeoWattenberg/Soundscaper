#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** GitHub-hosted entry point for the Framescaper shard's pinned Boost closure. */

import { resolve } from 'node:path';

import { runFramescaperBoostCiProvisioning } from './lib/framescaper-boost-ci.mjs';

if (process.argv.length !== 2) throw new TypeError('Framescaper Boost CI provisioning accepts no arguments.');

const result = await runFramescaperBoostCiProvisioning({
	repositoryRoot: resolve(process.cwd()),
	runnerTemp: process.env.RUNNER_TEMP,
	githubEnvironmentPath: process.env.GITHUB_ENV,
});
process.stdout.write(`Provisioned and authenticated Boost 1.92.0 headers in ${result.workspace}.\n`);
