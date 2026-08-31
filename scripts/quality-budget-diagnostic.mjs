/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { evaluateQualityBudgetResult } from './quality-budget-result.mjs';
import { verifyQualityBudgetResultFiles } from './verify-quality-budget-result.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRUCTURAL_ENVIRONMENT_ID = 'portable-node-structural-26.5.0';
const MEASUREMENT_CLASS = 'first-party-owned-structural-counters';

/**
 * Persist one no-retry structural workload result without overwriting prior
 * diagnostic output. Metrics are evaluated before any file is created and the completed
 * files are verified again from disk.
 *
 * @param {{
 *   configPath: string | URL,
 *   outputDirectory: string,
 *   workloadId: string,
 *   metrics: Readonly<Record<string, number>>,
 *   observations: Readonly<Record<string, unknown>>,
 * }} options
 * @param {{
 *   architecture: string,
 *   gitStatus: string,
 *   nodeVersion: string,
 *   npmVersion: string,
 *   platform: string,
 *   sourceRevision: string,
 * } | undefined} providedRuntime
 */
export async function writeStructuralQualityBudgetDiagnostic(options, providedRuntime = undefined) {
	const configPath = ownDataValue(options, 'configPath');
	const outputDirectory = ownDataValue(options, 'outputDirectory');
	const workloadId = ownDataValue(options, 'workloadId');
	const metrics = snapshotJsonData(ownDataValue(options, 'metrics'), 'metrics');
	const observations = snapshotJsonData(ownDataValue(options, 'observations'), 'observations');
	if ((typeof configPath !== 'string' && !(configPath instanceof URL))
		|| typeof outputDirectory !== 'string'
		|| typeof workloadId !== 'string') {
		throw new Error('Quality diagnostic options contain invalid path or workload fields.');
	}
	const runtime = providedRuntime === undefined
		? await collectRuntime()
		: snapshotJsonData(providedRuntime, 'runtime');
	if (runtime.gitStatus.trim() !== '') {
		throw new Error('Quality diagnostics require a clean checkout.');
	}
	const configBytes = await readFile(configPath);
	const config = JSON.parse(configBytes.toString('utf8'));
	const workload = exactDescriptor(config.workloads, workloadId, 'workload');
	if (!Array.isArray(workload.environmentIds)
		|| workload.environmentIds.length !== 1
		|| workload.environmentIds[0] !== STRUCTURAL_ENVIRONMENT_ID) {
		throw new Error(`Workload ${workloadId} does not own the structural environment.`);
	}
	const environment = exactDescriptor(
		config.environments,
		STRUCTURAL_ENVIRONMENT_ID,
		'environment',
	);
	const environmentFingerprint = {
		platform: runtime.platform,
		architecture: runtime.architecture,
		nodeVersion: runtime.nodeVersion,
		npmVersion: runtime.npmVersion,
		measurementClass: MEASUREMENT_CLASS,
	};
	const rawArtifactName = `${workloadId}.raw.json`;
	const resultArtifactName = `${workloadId}.result.json`;
	const rawPath = join(outputDirectory, rawArtifactName);
	const resultPath = join(outputDirectory, resultArtifactName);
	const raw = {
		schemaVersion: 1,
		workloadId,
		environmentId: STRUCTURAL_ENVIRONMENT_ID,
		environmentFingerprint,
		sourceRevision: runtime.sourceRevision,
		attemptCount: 1,
		retryCount: 0,
		metrics,
		observations,
	};
	const rawBytes = Buffer.from(`${JSON.stringify(raw, null, '\t')}\n`);
	const result = {
		schemaVersion: 1,
		workloadId,
		fixtureIds: workload.fixtureIds,
		environmentId: STRUCTURAL_ENVIRONMENT_ID,
		environmentFingerprint,
		rendererClass: 'unknown',
		budgetSha256: sha256(configBytes),
		sourceRevision: runtime.sourceRevision,
		attemptCount: 1,
		retryCount: 0,
		rawArtifact: {
			artifactName: rawArtifactName,
			byteLength: rawBytes.byteLength,
			sha256: sha256(rawBytes),
		},
		metrics,
	};
	const evaluation = evaluateQualityBudgetResult({
		workload,
		expectedEnvironment: environment,
		expectedBudgetSha256: result.budgetSha256,
		measurementPolicy: config.measurementPolicy,
	}, result);
	if (!evaluation.passed) throw new Error(evaluation.failures.join('\n'));

	await mkdir(outputDirectory, { recursive: true });
	await assertAbsent(rawPath);
	await assertAbsent(resultPath);
	await writeFile(rawPath, rawBytes, { flag: 'wx' });
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	const diskEvaluation = await verifyQualityBudgetResultFiles({
		configPath,
		resultPath,
		expectedSourceRevision: runtime.sourceRevision,
	});
	if (!diskEvaluation.passed) {
		throw new Error(`Written quality diagnostic failed verification:\n${diskEvaluation.failures.join('\n')}`);
	}
	return Object.freeze({ rawPath, resultPath, evaluation: diskEvaluation });
}

async function collectRuntime() {
	const [{ stdout: gitStatus }, { stdout: sourceRevision }, { stdout: npmVersion }] = await Promise.all([
		execFileAsync('git', ['status', '--porcelain=v1'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }),
		execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }),
		execFileAsync('npm', ['--version'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }),
	]);
	return Object.freeze({
		architecture: process.arch,
		gitStatus,
		nodeVersion: process.versions.node,
		npmVersion: npmVersion.trim(),
		platform: process.platform,
		sourceRevision: sourceRevision.trim(),
	});
}

function exactDescriptor(collection, id, label) {
	if (!Array.isArray(collection)) throw new Error(`Quality config has no ${label} descriptors.`);
	const matches = collection.filter((value) => isRecord(value) && value.id === id);
	if (matches.length !== 1) {
		throw new Error(`Quality config must contain exactly one ${label} descriptor for ${id}.`);
	}
	return matches[0];
}

function ownDataValue(record, property) {
	if (!isRecord(record)) throw new Error('Quality diagnostic options must be a plain record.');
	const descriptor = Object.getOwnPropertyDescriptor(record, property);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new Error(`Quality diagnostic ${property} must use only own data properties.`);
	}
	return descriptor.value;
}

function snapshotJsonData(value, path) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`Quality diagnostic ${path} must be finite JSON data.`);
		return value;
	}
	if (Array.isArray(value)) {
		const snapshot = [];
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
				throw new Error(`Quality diagnostic ${path} must contain only own data properties.`);
			}
			snapshot.push(snapshotJsonData(descriptor.value, `${path}[${index}]`));
		}
		return snapshot;
	}
	if (!isRecord(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new Error(`Quality diagnostic ${path} must be plain JSON data.`);
	}
	const snapshot = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new Error(`Quality diagnostic ${path} must contain only string-keyed own data properties.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new Error(`Quality diagnostic ${path} must contain only own data properties.`);
		}
		snapshot[key] = snapshotJsonData(descriptor.value, `${path}.${key}`);
	}
	return snapshot;
}

async function assertAbsent(path) {
	try {
		await access(path);
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}
	throw new Error(`Quality diagnostic already exists at ${path}.`);
}

function isMissingFile(error) {
	return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
