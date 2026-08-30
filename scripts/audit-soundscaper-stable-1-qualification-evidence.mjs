#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { auditSoundscaperStable1QualificationEvidence } from
	'./lib/soundscaper-stable-1-qualification-evidence.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function runSoundscaperStable1QualificationAudit() {
	const audit = await auditSoundscaperStable1QualificationEvidence({ repositoryRoot: REPOSITORY_ROOT });
	process.stdout.write(`${JSON.stringify(audit, null, '\t')}\n`);
	return audit.passed ? 0 : 1;
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	runSoundscaperStable1QualificationAudit().then(
		(exitCode) => { process.exitCode = exitCode; },
		(error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 2;
		},
	);
}
