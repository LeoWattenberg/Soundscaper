#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	formatDesktopDirectWavSmokeAggregate,
	runDesktopDirectWavSmoke,
} from './lib/desktop-direct-wav-smoke.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aggregate = await runDesktopDirectWavSmoke({ repositoryRoot });
console.log(formatDesktopDirectWavSmokeAggregate(aggregate));
