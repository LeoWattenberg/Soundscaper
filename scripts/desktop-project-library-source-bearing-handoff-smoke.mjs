#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	formatDesktopProjectLibrarySourceBearingAggregate,
	runDesktopProjectLibrarySourceBearingHandoff,
} from './lib/desktop-project-library-source-bearing-handoff.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aggregate = await runDesktopProjectLibrarySourceBearingHandoff({ repositoryRoot });

console.log(formatDesktopProjectLibrarySourceBearingAggregate(aggregate));
