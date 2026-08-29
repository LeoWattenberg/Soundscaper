#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	evaluateMilestone9ReleaseAdmission,
	parseMilestone9GuidedVerification,
} from './lib/milestone-9-release-admission.mjs';
import { validateMilestone9BehaviorEnvironmentMatrix } from './lib/milestone-9-behavior-environments.mjs';
import { auditMilestone9QualificationEvidence } from './lib/milestone-9-qualification-evidence.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_RECORD = new URL('../docs/milestone-9-guided-verification.md', import.meta.url);
const DEFAULT_BEHAVIOR_ENVIRONMENTS = new URL(
	'../config/milestone-9-behavior-environments.json', import.meta.url,
);

function parseArguments(argv) {
	let json = false;
	let record = DEFAULT_RECORD;
	let behaviorEnvironments = DEFAULT_BEHAVIOR_ENVIRONMENTS;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--json') {
			json = true;
			continue;
		}
		if (argument === '--record') {
			const value = argv[index += 1];
			if (!value) throw new Error('--record requires a Markdown path.');
			record = pathToFileURL(resolve(value));
			continue;
		}
		if (argument === '--behavior-environments') {
			const value = argv[index += 1];
			if (!value) throw new Error('--behavior-environments requires a JSON path.');
			behaviorEnvironments = pathToFileURL(resolve(value));
			continue;
		}
		throw new Error(`Unexpected argument: ${argument}`);
	}
	return { json, record, behaviorEnvironments };
}

export async function runMilestone9ReleaseAdmissionCli(
	argv = process.argv.slice(2),
	dependencies = {},
) {
	const { json, record, behaviorEnvironments } = parseArguments(argv);
	const [markdown, behaviorMatrixBytes] = await Promise.all([
		readFile(record, 'utf8'),
		readFile(behaviorEnvironments, 'utf8'),
	]);
	const behaviorEnvironmentMatrix = validateMilestone9BehaviorEnvironmentMatrix(
		JSON.parse(behaviorMatrixBytes),
	);
	const auditQualificationEvidence = dependencies.auditMilestone9QualificationEvidence
		?? auditMilestone9QualificationEvidence;
	const writeOutput = dependencies.writeOutput ?? ((value) => process.stdout.write(value));
	if (typeof auditQualificationEvidence !== 'function' || typeof writeOutput !== 'function') {
		throw new TypeError('Milestone 9 release-admission dependencies are invalid.');
	}
	const qualificationEvidenceAudit = await auditQualificationEvidence({
		repositoryRoot: REPOSITORY_ROOT,
		behaviorEnvironmentMatrix,
	});
	const result = evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(markdown), {
		behaviorEnvironmentMatrix,
		qualificationEvidenceAudit,
	});
	if (json) {
		writeOutput(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		const state = result.admitted ? 'admitted' : 'blocked';
		writeOutput(`Stable 1.0 release is ${state} by the Milestone 9 human-check record.\n`);
		writeOutput(`Results: ${Object.entries(result.counts).map(([name, count]) => `${name}=${count}`).join(', ')}\n`);
		for (const reason of result.reasons) writeOutput(`- ${reason}\n`);
	}
	return result.admitted ? 0 : 1;
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	runMilestone9ReleaseAdmissionCli().then(
		(exitCode) => {
			process.exitCode = exitCode;
		},
		(error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 2;
		},
	);
}
