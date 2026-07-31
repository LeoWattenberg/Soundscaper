#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	formatDesktopScapePersistenceSmokeResult,
	runDesktopScapePersistenceSmoke,
} from './lib/desktop-scape-reopen-smoke.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await runDesktopScapePersistenceSmoke({ repositoryRoot });
console.log(formatDesktopScapePersistenceSmokeResult(result));
