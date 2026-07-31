#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	formatDesktopScapeOpenSmokeResult,
	runDesktopScapeOpenSmoke,
} from './lib/desktop-scape-open-smoke.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await runDesktopScapeOpenSmoke({ repositoryRoot });
console.log(formatDesktopScapeOpenSmokeResult(result));
