#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	evaluateSoundscaperStable1ReleaseAdmission,
	parseSoundscaperStable1GuidedVerification,
} from './lib/soundscaper-stable-1-release-admission.mjs';
import { validateSoundscaperStable1BehaviorEnvironmentMatrix } from
	'./lib/soundscaper-stable-1-behavior-environments.mjs';
import { auditSoundscaperStable1QualificationEvidence } from
	'./lib/soundscaper-stable-1-qualification-evidence.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_RECORD = new URL('../docs/soundscaper-stable-1-guided-verification.md', import.meta.url);
const DEFAULT_BEHAVIOR_ENVIRONMENTS = new URL(
	'../config/soundscaper-stable-1-behavior-environments.json', import.meta.url,
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

export async function runSoundscaperStable1ReleaseAdmissionCli(
	argv = process.argv.slice(2),
	dependencies = {},
) {
	const { json, record, behaviorEnvironments } = parseArguments(argv);
	const [markdown, behaviorMatrixBytes] = await Promise.all([
		readFile(record, 'utf8'),
		readFile(behaviorEnvironments, 'utf8'),
	]);
	const behaviorEnvironmentMatrix = validateSoundscaperStable1BehaviorEnvironmentMatrix(
		JSON.parse(behaviorMatrixBytes),
	);
	const auditQualificationEvidence = dependencies.auditSoundscaperStable1QualificationEvidence
		?? auditSoundscaperStable1QualificationEvidence;
	const auditNativeReadiness = dependencies.auditSoundscaperProfessionalNativeStablePayloads
		?? defaultNativeReadinessAudit;
	const writeOutput = dependencies.writeOutput ?? ((value) => process.stdout.write(value));
	if (typeof auditQualificationEvidence !== 'function' || typeof auditNativeReadiness !== 'function'
		|| typeof writeOutput !== 'function') {
		throw new TypeError('Soundscaper Stable 1 release-admission dependencies are invalid.');
	}
	const [qualificationEvidenceAudit, nativeReadinessAudit] = await Promise.all([
		auditQualificationEvidence({ repositoryRoot: REPOSITORY_ROOT, behaviorEnvironmentMatrix }),
		auditNativeReadiness({ repositoryRoot: REPOSITORY_ROOT }),
	]);
	const result = evaluateSoundscaperStable1ReleaseAdmission(
		parseSoundscaperStable1GuidedVerification(markdown), {
			behaviorEnvironmentMatrix,
			qualificationEvidenceAudit,
			nativeReadinessAudit,
		},
	);
	if (json) {
		writeOutput(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		writeOutput(`Soundscaper Stable 1 is ${result.admitted ? 'admitted' : 'blocked'}.\n`);
		writeOutput(`Results: ${Object.entries(result.counts)
			.map(([name, count]) => `${name}=${count}`).join(', ')}\n`);
		for (const reason of result.reasons) writeOutput(`- ${reason}\n`);
	}
	return result.admitted ? 0 : 1;
}

async function defaultNativeReadinessAudit(options) {
	const module = await import('./lib/soundscaper-professional-native-payload.mjs');
	if (typeof module.auditSoundscaperProfessionalNativeStablePayloads !== 'function') {
		throw new Error('Soundscaper stable native-readiness audit is unavailable.');
	}
	return module.auditSoundscaperProfessionalNativeStablePayloads(options);
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	runSoundscaperStable1ReleaseAdmissionCli().then(
		(exitCode) => { process.exitCode = exitCode; },
		(error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 2;
		},
	);
}
