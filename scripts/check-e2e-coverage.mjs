#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { runE2ECoverageGate } from './lib/e2e-coverage-runner.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const artifactRoot = resolve(repositoryRoot, process.argv[2] ?? 'coverage/e2e');
const reportRoot = resolve(repositoryRoot, process.argv[3] ?? 'coverage/e2e-report');
const result = runE2ECoverageGate({ repositoryRoot, artifactRoot, reportRoot });

process.exitCode = result.failures.length === 0 ? 0 : 1;
