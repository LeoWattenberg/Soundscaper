#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { runCoverageGate } from './lib/coverage-gate-runner.mjs';

const root = resolve(import.meta.dirname, '..');
const temporaryDirectory = process.argv[2] ?? 'coverage/v8-all';

process.exitCode = runCoverageGate(root, temporaryDirectory) ? 0 : 1;
