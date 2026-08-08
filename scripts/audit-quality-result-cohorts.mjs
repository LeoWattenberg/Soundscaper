#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudgetResult } from './quality-budget-result.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const REVISION_PATTERN = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

export async function auditQualityResultCohorts(config, dependencies = {}) {
	const failures = [];
	const qualifiedIds = config?.qualification?.qualifiedWorkloadIds;
	const cohorts = config?.qualification?.acceptedResultCohorts;
	if (!Array.isArray(qualifiedIds) || !Array.isArray(cohorts)) {
		return failedAudit(['Quality config has no qualified workload cohort contract.']);
	}
	const artifactIds = cohorts.flatMap((cohort) =>
		Array.isArray(cohort?.artifacts) ? cohort.artifacts.map((artifact) => artifact?.workloadId) : []);
	if (!sameArray(artifactIds, qualifiedIds) || new Set(artifactIds).size !== artifactIds.length) {
		failures.push('Accepted cohorts must cover the exact qualified workload set once.');
	}
	for (const workloadId of qualifiedIds) {
		const workload = Array.isArray(config.workloads)
			? config.workloads.find((candidate) => candidate?.id === workloadId)
			: undefined;
		if (workload?.status !== 'qualified') {
			failures.push(`Qualified workload ${workloadId} must have qualified status.`);
		}
	}

	const loadHistoricalBudget = dependencies.loadHistoricalBudget ?? defaultHistoricalBudget;
	for (const cohort of cohorts) {
		if (!isRecord(cohort) || !REVISION_PATTERN.test(cohort.sourceRevision ?? '')) {
			failures.push('Accepted cohort source revision must be one Git object ID.');
			continue;
		}
		if (cohort.attemptCount !== 1 || cohort.retryCount !== 0) {
			failures.push(`Accepted cohort ${cohort.id} must have one attempt and zero retries.`);
		}
		let historicalBytes;
		try {
			historicalBytes = await loadHistoricalBudget(cohort.sourceRevision);
		} catch (error) {
			failures.push(`Accepted cohort ${cohort.id} historical budget could not be loaded: ${message(error)}.`);
			continue;
		}
		const historicalDigest = sha256(historicalBytes);
		if (historicalDigest !== cohort.budgetSha256) {
			failures.push(`Accepted cohort ${cohort.id} historical budget digest does not match.`);
		}
		let historical;
		try {
			historical = JSON.parse(Buffer.from(historicalBytes).toString('utf8'));
		} catch (error) {
			failures.push(`Accepted cohort ${cohort.id} historical budget is invalid JSON: ${message(error)}.`);
			continue;
		}
		if (!Array.isArray(cohort.artifacts)) {
			failures.push(`Accepted cohort ${cohort.id} has no artifacts.`);
			continue;
		}
		for (const artifact of cohort.artifacts) {
			validateArtifactDescriptor(artifact, failures);
			if (dependencies.loadArtifact) {
				await auditArtifactBodies({
					artifact, cohort, historical, historicalDigest,
					loadArtifact: dependencies.loadArtifact, failures,
				});
			}
		}
	}

	return Object.freeze({
		passed: failures.length === 0,
		failures: Object.freeze(failures),
		cohortCount: cohorts.length,
		artifactCount: artifactIds.length,
	});
}

async function auditArtifactBodies(context) {
	let resultBytes;
	let rawBytes;
	try {
		[resultBytes, rawBytes] = await Promise.all([
			context.loadArtifact(context.cohort, context.artifact, 'result'),
			context.loadArtifact(context.cohort, context.artifact, 'raw'),
		]);
	} catch (error) {
		context.failures.push(`Artifact ${context.artifact.workloadId} could not be loaded: ${message(error)}.`);
		return;
	}
	validateBody('Result', resultBytes, context.artifact.resultByteLength, context.artifact.resultSha256, context.failures);
	validateBody('Raw', rawBytes, context.artifact.rawByteLength, context.artifact.rawSha256, context.failures);
	let result;
	let raw;
	try {
		result = JSON.parse(Buffer.from(resultBytes).toString('utf8'));
		raw = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
	} catch (error) {
		context.failures.push(`Artifact ${context.artifact.workloadId} is invalid JSON: ${message(error)}.`);
		return;
	}
	if (result.workloadId !== context.artifact.workloadId
		|| result.sourceRevision !== context.cohort.sourceRevision
		|| result.budgetSha256 !== context.historicalDigest
		|| result.environmentId !== context.cohort.environmentId) {
		context.failures.push(`Result artifact ${context.artifact.workloadId} identity does not match its cohort.`);
	}
	if (result.rawEvidence?.byteLength !== Buffer.byteLength(rawBytes)
		|| result.rawEvidence?.sha256 !== sha256(rawBytes)
		|| raw.workloadId !== result.workloadId
		|| JSON.stringify(raw.metrics) !== JSON.stringify(result.metrics)) {
		context.failures.push(`Raw artifact ${context.artifact.workloadId} does not match its result.`);
	}
	const workload = context.historical.workloads?.find(({ id }) => id === result.workloadId);
	const environment = context.historical.environments?.find(({ id }) => id === result.environmentId);
	if (!workload || !environment) {
		context.failures.push(`Historical descriptors are missing for ${context.artifact.workloadId}.`);
		return;
	}
	const evaluation = evaluateQualityBudgetResult({
		workload,
		expectedEnvironment: environment,
		expectedBudgetSha256: context.historicalDigest,
		measurementPolicy: context.historical.measurementPolicy,
	}, result);
	if (!evaluation.passed) context.failures.push(...evaluation.failures);
}

function validateArtifactDescriptor(artifact, failures) {
	if (!isRecord(artifact) || typeof artifact.workloadId !== 'string') {
		failures.push('Accepted cohort artifact must name a workload.');
		return;
	}
	for (const [lengthField, digestField] of [
		['resultByteLength', 'resultSha256'], ['rawByteLength', 'rawSha256'],
	]) {
		if (!Number.isSafeInteger(artifact[lengthField]) || artifact[lengthField] <= 0
			|| !SHA256_PATTERN.test(artifact[digestField] ?? '')) {
			failures.push(`Accepted cohort artifact ${artifact.workloadId} has invalid length or digest.`);
		}
	}
}

function validateBody(label, bytes, expectedLength, expectedDigest, failures) {
	if (Buffer.byteLength(bytes) !== expectedLength || sha256(bytes) !== expectedDigest) {
		failures.push(`${label} artifact byte length or digest does not match.`);
	}
}

async function defaultHistoricalBudget(sourceRevision) {
	const { stdout } = await execFileAsync(
		'git', ['show', `${sourceRevision}:config/quality-budgets.json`],
		{ cwd: REPOSITORY_ROOT, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
	);
	return stdout;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function sameArray(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}

function failedAudit(failures) {
	return Object.freeze({
		passed: false,
		failures: Object.freeze(failures),
		cohortCount: 0,
		artifactCount: 0,
	});
}

async function main() {
	if (process.argv.length !== 2 && !(process.argv.length === 4 && process.argv[2] === '--evidence-directory')) {
		process.stderr.write('Usage: node scripts/audit-quality-result-cohorts.mjs [--evidence-directory <path>]\n');
		process.exitCode = 2;
		return;
	}
	const config = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const evidenceDirectory = process.argv[3] ? resolve(process.argv[3]) : null;
	const audit = await auditQualityResultCohorts(config, evidenceDirectory ? {
		loadArtifact: async (_cohort, artifact, kind) => readFile(join(
			evidenceDirectory,
			`${artifact.workloadId}.${kind === 'result' ? 'accepted' : 'raw'}.json`,
		)),
	} : {});
	process.stdout.write(`${JSON.stringify(audit, null, '\t')}\n`);
	if (!audit.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
