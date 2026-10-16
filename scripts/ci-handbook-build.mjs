#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { recordCiHandbookBuild, verifyCiHandbookBuild } from './lib/ci-handbook-build.ts';

const mode = process.argv[2];
if (mode === 'record') recordCiHandbookBuild();
else if (mode === 'verify') verifyCiHandbookBuild();
else throw new Error('Expected record or verify for the checked CI handbook build.');
