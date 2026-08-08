#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
	formatDesktopProjectLibraryLeaseMatrix,
	runDesktopProjectLibraryLeaseMatrix,
} from './lib/desktop-project-library-lease-matrix.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await runDesktopProjectLibraryLeaseMatrix({ repositoryRoot });
const formatted = formatDesktopProjectLibraryLeaseMatrix(result);
if (process.env.SOUNDSCAPER_LEASE_MATRIX_RESULT) {
	await writeFile(process.env.SOUNDSCAPER_LEASE_MATRIX_RESULT, JSON.stringify(result));
}
console.log(formatted);
