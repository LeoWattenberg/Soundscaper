#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { prepareDesktopRuntimeTestArtifact } from './lib/node-test-desktop-runtime-artifact.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(repositoryRoot, process.argv[2] || '.wrangler/node-desktop-runtime-fixture');
// This producer process remains covered; dependency compiler subprocesses do not.
delete process.env.NODE_V8_COVERAGE;
await prepareDesktopRuntimeTestArtifact({ repositoryRoot, fixtureRoot });
