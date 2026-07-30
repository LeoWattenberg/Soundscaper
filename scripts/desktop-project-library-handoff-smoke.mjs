#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	formatDesktopProjectLibraryHandoffAggregate,
	runDesktopProjectLibraryHandoffSmoke,
} from './lib/desktop-project-library-handoff-smoke.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aggregate = await runDesktopProjectLibraryHandoffSmoke({ repositoryRoot });

console.log(formatDesktopProjectLibraryHandoffAggregate(aggregate));
