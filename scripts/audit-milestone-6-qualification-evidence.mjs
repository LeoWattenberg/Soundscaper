#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { auditMilestone6QualificationEvidence } from './lib/milestone-6-qualification-evidence.mjs';

try {
	const audit = await auditMilestone6QualificationEvidence({ repositoryRoot: resolve(process.cwd()) });
	process.stdout.write(`${JSON.stringify(audit, null, '\t')}\n`);
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
