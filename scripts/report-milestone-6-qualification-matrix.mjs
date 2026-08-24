#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { auditMilestone6QualificationEvidence } from './lib/milestone-6-qualification-evidence.mjs';

try {
	const { status, qualificationReady, blockers, collectionContract, matrix } =
		await auditMilestone6QualificationEvidence({ repositoryRoot: resolve(process.cwd()) });
	process.stdout.write(`${JSON.stringify({
		status, qualificationReady, blockers, collectionContract, matrix,
	}, null, '\t')}\n`);
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
