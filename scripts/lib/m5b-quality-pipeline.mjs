/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
	boundedString,
	deepFreeze,
	exactRecord,
	isRecord,
	requireRecord,
} from './measurement-validation.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import {
	DEFAULT_QUALITY_BUDGET_SHA256,
	qualityBudgetSha256,
} from './quality-budget-config-digest.mjs';
import {
	evaluateQualityWorkload,
	qualityWorkloadBudget,
} from './quality-budget-config.mjs';
import {
	M5B_WORKLOAD_DEFAULT_OUTPUT_BYTES,
	M5B_WORKLOAD_DEFAULT_TIMEOUT_MILLISECONDS,
	M5B_WORKLOAD_MAX_OUTPUT_BYTES,
	M5B_WORKLOAD_MAX_TIMEOUT_MILLISECONDS,
	fingerprintM5bWorkloadExecutable,
	runM5bQualityWorkload,
	validateM5bWorkloadCommand,
} from './m5b-quality-workload-runner.mjs';

const CONFIG_URL = new URL('../../config/quality-budgets.json', import.meta.url);
const DEFAULT_CONFIG_BYTES = await readFile(CONFIG_URL);
const DEFAULT_CONFIG = JSON.parse(DEFAULT_CONFIG_BYTES.toString('utf8'));
export const M5B_DEFAULT_QUALITY_BUDGET_SHA256 = DEFAULT_QUALITY_BUDGET_SHA256;
const ENVIRONMENT_ID = 'native-os-diagnostics';
const PLATFORM_ARCHITECTURES = Object.freeze({
	windowsX64: 'x64',
	windowsArm64: 'arm64',
	macosArm64: 'arm64',
	linuxX64: 'x64',
	linuxArm64: 'arm64',
});
const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);
const FINGERPRINT_FIELDS = Object.freeze([
	'platformId',
	'architecture',
	'osVersion',
	'cpuModel',
	'gpuModel',
	'driverVersion',
	'sourceRevision',
	'packageSha256',
	'mediaHostSha256',
	'workloadRunnerSha256',
	'ofxScannerSha256',
	'ofxRuntimeHostSha256',
]);
const MEASUREMENT_FIELDS = Object.freeze([
	'schemaVersion',
	'budgetSha256',
	'sourceRevision',
	'attemptCount',
	'retryCount',
	'profileId',
	'workloadId',
	'fixtureId',
	'environmentId',
	'platformId',
	'rendererClass',
	'observedFingerprint',
	'metrics',
	'sampleCounts',
]);
const WORKLOAD_DIAGNOSTIC_FIELDS = Object.freeze([
	'schemaVersion',
	'diagnosticType',
	'profileId',
	'workloadId',
	'fixtureId',
	'measurement',
]);
export const M5B_WORKLOAD_DIAGNOSTIC_TYPE = 'soundscaper.m5b-quality-workload-diagnostic';
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export const M5B_QUALITY_PIPELINES = deepFreeze({
	'native-media': {
		workloadId: 'm5b-native-media-plan-parity-and-decode',
		fixtureId: 'm5b-native-media-parity-and-longform-v1',
	},
	'professional-media': {
		workloadId: 'm5b-professional-media-tier',
		fixtureId: 'm5b-professional-format-row-suite-v1',
	},
	'persistent-services': {
		workloadId: 'm5b-persistent-services-recovery',
		fixtureId: 'm5b-persistent-services-fault-v1',
	},
	'clean-display': {
		workloadId: 'm5b-clean-external-display',
		fixtureId: 'm5b-clean-display-30m-v1',
	},
	openfx: {
		workloadId: 'm5b-openfx-isolation-and-packaging',
		fixtureId: 'm5b-openfx-conformance-and-hostile-v1',
	},
});

export function validateM5bQualityMeasurement(profileIdValue, value, configValue = DEFAULT_CONFIG) {
	const profileId = pipelineId(profileIdValue);
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const budgetSha256 = m5bQualityBudgetSha256(configValue);
	const config = snapshotStrictJsonData(configValue, 'quality config');
	const workload = qualityWorkloadBudget(config, pipeline.workloadId);
	assertRegistration(profileId, pipeline, workload);
	const thresholdIds = workload.thresholds.map((threshold) => threshold.metricId);
	const record = exactRecord(
		snapshotStrictJsonData(value, `${profileId} measurement`),
		MEASUREMENT_FIELDS,
		`${profileId} measurement`,
	);
	if (record.schemaVersion !== 1) throw new Error(`${profileId} measurement schemaVersion must be 1.`);
	if (record.budgetSha256 !== budgetSha256) throw new Error(`${profileId} measurement budget digest does not match.`);
	if (typeof record.sourceRevision !== 'string' || !SOURCE_REVISION.test(record.sourceRevision)) {
		throw new Error(`${profileId} measurement source revision is invalid.`);
	}
	if (record.attemptCount !== 1) throw new Error(`${profileId} measurement must be one no-retry attempt.`);
	if (record.retryCount !== 0) {
		throw new Error(`${profileId} measurement retry count must be zero.`);
	}
	if (record.profileId !== profileId) throw new Error(`${profileId} measurement profileId does not match.`);
	if (record.workloadId !== pipeline.workloadId) throw new Error(`${profileId} measurement workloadId does not match.`);
	if (record.fixtureId !== pipeline.fixtureId) throw new Error(`${profileId} measurement fixtureId does not match.`);
	if (record.environmentId !== ENVIRONMENT_ID) throw new Error(`${profileId} measurement environmentId does not match.`);
	const platformId = platform(record.platformId, `${profileId} measurement.platformId`);
	if (!['hardware', 'software', 'unknown'].includes(record.rendererClass)) {
		throw new Error(`${profileId} measurement.rendererClass is unsupported.`);
	}
	const fingerprint = validateFingerprint(record.observedFingerprint, platformId, profileId);
	if (fingerprint.sourceRevision !== record.sourceRevision) {
		throw new Error(`${profileId} measurement source revision does not match its fingerprint.`);
	}
	const metrics = exactMetricRecord(record.metrics, thresholdIds, 'metrics', finiteNonNegative);
	const sampleCounts = exactMetricRecord(record.sampleCounts, thresholdIds, 'sampleCounts', positiveInteger);
	return deepFreeze({
		schemaVersion: 1,
		budgetSha256,
		sourceRevision: record.sourceRevision,
		attemptCount: 1,
		retryCount: 0,
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: ENVIRONMENT_ID,
		platformId,
		rendererClass: record.rendererClass,
		observedFingerprint: fingerprint,
		metrics,
		sampleCounts,
	});
}

export function createM5bQualityResult(profileIdValue, measurementValue, configValue = DEFAULT_CONFIG) {
	const profileId = pipelineId(profileIdValue);
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const config = snapshotStrictJsonData(configValue, 'quality config');
	const measurement = validateM5bQualityMeasurement(profileId, measurementValue, config);
	const workload = qualityWorkloadBudget(config, pipeline.workloadId);
	assertRegistration(profileId, pipeline, workload);
	const evaluation = evaluateQualityWorkload(config, workload, measurement.metrics);
	const metricGatePassed = evaluation.passed;
	const passed = metricGatePassed;
	return deepFreeze({
		schemaVersion: 1,
		status: passed ? 'passed' : 'failed',
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: ENVIRONMENT_ID,
		platformId: measurement.platformId,
		rendererClass: measurement.rendererClass,
		observedFingerprint: measurement.observedFingerprint,
		metrics: measurement.metrics,
		sampleCounts: measurement.sampleCounts,
		metricGatePassed,
		evaluation,
	});
}

export async function collectM5bQuality(profileIdValue, optionsValue, dependencies = {}) {
	const profileId = pipelineId(profileIdValue);
	const options = collectorOptions(optionsValue);
	assertM5bCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? DEFAULT_CONFIG;
	let workloadExecutableSha256 = null;
	let measurementValue;
	if (options.measurementPath === null) {
		const fingerprintExecutable = dependencies.fingerprintExecutable
			?? fingerprintM5bWorkloadExecutable;
		workloadExecutableSha256 = await fingerprintExecutable(options.workloadCommand.executable);
		measurementValue = await (dependencies.runWorkload ?? runM5bQualityWorkload)(options.workloadCommand);
		const settledExecutableSha256 = await fingerprintExecutable(options.workloadCommand.executable);
		if (settledExecutableSha256 !== workloadExecutableSha256) {
			throw new Error('5B workload executable changed while its measurement was collected.');
		}
	} else {
		measurementValue = await (dependencies.readMeasurement ?? readMeasurementFile)(options.measurementPath);
	}
	const measurement = validateM5bQualityMeasurement(
		profileId,
		options.measurementPath === null
			? measurementFromWorkloadDiagnostic(profileId, measurementValue)
			: measurementValue,
		config,
	);
	if (workloadExecutableSha256 !== null
		&& measurement.observedFingerprint.workloadRunnerSha256 !== workloadExecutableSha256) {
		throw new Error('5B workload runner executable digest does not match the measured fingerprint.');
	}
	const result = createM5bQualityResult(profileId, measurement, config);
	const writeResult = dependencies.writeResult ?? writeM5bQualityResult;
	return writeResult(
		boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory'),
		measurement,
		result,
		config,
	);
}

export async function writeM5bQualityResult(
	outputDirectory,
	measurementValue,
	resultValue,
	configValue = DEFAULT_CONFIG,
) {
	const measurement = snapshotStrictJsonData(measurementValue, 'measurement');
	const result = snapshotStrictJsonData(resultValue, 'result');
	const expected = createM5bQualityResult(measurement.profileId, measurement, configValue);
	if (!isDeepStrictEqual(result, expected)) {
		throw new Error('5B diagnostic result does not match its recomputed thresholds.');
	}
	const stem = `${result.workloadId}.${result.platformId}`;
	const rawBytes = Buffer.from(`${JSON.stringify(measurement, null, '\t')}\n`, 'utf8');
	const raw = Object.freeze({
		file: `${stem}.raw.json`,
		byteLength: rawBytes.byteLength,
		sha256: createHash('sha256').update(rawBytes).digest('hex'),
	});
	const boundResult = deepFreeze({ ...result, raw });
	const resultBytes = Buffer.from(`${JSON.stringify(boundResult, null, '\t')}\n`, 'utf8');
	await mkdir(outputDirectory, { recursive: true });
	const rawPath = join(outputDirectory, raw.file);
	const resultPath = join(outputDirectory, `${stem}.${result.status}.json`);
	await writeFile(rawPath, rawBytes, { flag: 'wx' });
	await writeFile(resultPath, resultBytes, { flag: 'wx' });
	return Object.freeze({ rawPath, resultPath, result: boundResult });
}

export function m5bQualityBudgetSha256(configValue = DEFAULT_CONFIG, exactBytes = null) {
	return qualityBudgetSha256(configValue, exactBytes);
}

export function assertM5bCollectionHost(environment) {
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const descriptor = Object.getOwnPropertyDescriptor(environment, key);
		if (!descriptor) continue;
		if (!Object.hasOwn(descriptor, 'value')
			|| (descriptor.value !== undefined && typeof descriptor.value !== 'string')) {
			throw new Error(`Collector environment ${key} must be an own string data property.`);
		}
		if (descriptor.value) {
			throw new Error(`5B native-diagnostic collection refuses hosted-runner evidence (${key} is set).`);
		}
	}
}

export async function runM5bQualityCollectorCli(profileIdValue) {
	const profileId = pipelineId(profileIdValue);
	const options = parseM5bQualityCollectorCliArguments(process.argv.slice(2));
	if (options.measurementPath === null && options.workloadCommand === null) {
		process.stderr.write(
			`Usage: node scripts/collect-m5b-${profileId}-quality.mjs `
			+ `(--measurement <record.json> | --run <absolute-executable> [runner-options] -- [arguments...]) `
			+ `[output-directory]\n`,
		);
		process.exitCode = 2;
		return;
	}
	const collectionOptions = {
		outputDirectory: resolve(options.outputDirectory ?? fileURLToPath(
			new URL(`../../test-results/quality/m5b-${profileId}`, import.meta.url),
		)),
		...(options.measurementPath === null
			? { workloadCommand: options.workloadCommand }
			: { measurementPath: resolve(options.measurementPath) }),
	};
	const collected = await collectM5bQuality(profileId, collectionOptions);
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status === 'failed') process.exitCode = 1;
}

export function parseM5bQualityCollectorCliArguments(argsValue) {
	const args = snapshotStrictJsonData(argsValue, '5B collector CLI arguments');
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('5B collector CLI arguments must be strings.');
	}
	const separator = args.indexOf('--');
	const optionArguments = separator < 0 ? args : args.slice(0, separator);
	const workloadArguments = separator < 0 ? [] : args.slice(separator + 1);
	let measurementPath = null;
	let outputDirectory = null;
	let executable = null;
	let timeoutMilliseconds = M5B_WORKLOAD_DEFAULT_TIMEOUT_MILLISECONDS;
	let maxOutputBytes = M5B_WORKLOAD_DEFAULT_OUTPUT_BYTES;
	let timeoutSpecified = false;
	let outputLimitSpecified = false;
	for (let index = 0; index < optionArguments.length; index += 1) {
		const argument = optionArguments[index];
		if (argument === '--measurement') {
			if (measurementPath !== null || index + 1 >= optionArguments.length) {
				throw new Error('5B collector requires exactly one measurement path.');
			}
			measurementPath = optionArguments[index += 1];
			continue;
		}
		if (argument === '--run') {
			if (executable !== null || index + 1 >= optionArguments.length) {
				throw new Error('5B collector requires exactly one workload executable.');
			}
			executable = optionArguments[index += 1];
			continue;
		}
		if (argument === '--timeout-ms') {
			if (timeoutSpecified || index + 1 >= optionArguments.length) {
				throw new Error('5B collector accepts one workload timeout.');
			}
			timeoutSpecified = true;
			timeoutMilliseconds = cliInteger(
				optionArguments[index += 1],
				M5B_WORKLOAD_MAX_TIMEOUT_MILLISECONDS,
				'workload timeout',
			);
			continue;
		}
		if (argument === '--max-output-bytes') {
			if (outputLimitSpecified || index + 1 >= optionArguments.length) {
				throw new Error('5B collector accepts one workload output limit.');
			}
			outputLimitSpecified = true;
			maxOutputBytes = cliInteger(
				optionArguments[index += 1],
				M5B_WORKLOAD_MAX_OUTPUT_BYTES,
				'workload output limit',
			);
			continue;
		}
		if (argument === '--output-directory') {
			if (outputDirectory !== null || index + 1 >= optionArguments.length) {
				throw new Error('5B collector accepts one output directory.');
			}
			outputDirectory = optionArguments[index += 1];
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown 5B collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('5B collector accepts one output directory.');
		outputDirectory = argument;
	}
	if (measurementPath !== null && executable !== null) {
		throw new Error('5B collector measurement and workload modes are mutually exclusive.');
	}
	if (executable === null && (workloadArguments.length > 0 || separator >= 0)) {
		throw new Error('5B collector workload arguments require --run.');
	}
	if (executable === null && (timeoutSpecified || outputLimitSpecified)) {
		throw new Error('5B collector workload bounds require --run.');
	}
	const workloadCommand = executable === null ? null : Object.freeze({
		executable,
		arguments: Object.freeze([...workloadArguments]),
		timeoutMilliseconds,
		maxOutputBytes,
	});
	return Object.freeze({ measurementPath, outputDirectory, workloadCommand });
}

function collectorOptions(value) {
	const record = requireRecord(
		snapshotStrictJsonData(value, 'collector options'),
		'collector options',
	);
	const hasMeasurement = Object.hasOwn(record, 'measurementPath');
	const hasWorkload = Object.hasOwn(record, 'workloadCommand');
	if (hasMeasurement === hasWorkload) {
		throw new Error('5B collector measurement and workload modes are mutually exclusive.');
	}
	const fields = hasMeasurement
		? ['measurementPath', 'outputDirectory']
		: ['workloadCommand', 'outputDirectory'];
	exactRecord(record, fields, 'collector options');
	const outputDirectory = boundedString(record.outputDirectory, 1, 4_096, 'outputDirectory');
	return hasMeasurement
		? Object.freeze({
			measurementPath: boundedString(record.measurementPath, 1, 4_096, 'measurementPath'),
			outputDirectory,
			workloadCommand: null,
		})
		: Object.freeze({
			measurementPath: null,
			outputDirectory,
			workloadCommand: validateM5bWorkloadCommand(record.workloadCommand),
		});
}

function measurementFromWorkloadDiagnostic(profileId, value) {
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const diagnostic = exactRecord(
		snapshotStrictJsonData(value, `${profileId} workload diagnostic`),
		WORKLOAD_DIAGNOSTIC_FIELDS,
		`${profileId} workload diagnostic`,
	);
	if (diagnostic.schemaVersion !== 1 || diagnostic.diagnosticType !== M5B_WORKLOAD_DIAGNOSTIC_TYPE) {
		throw new Error(`${profileId} workload diagnostic protocol is unsupported.`);
	}
	if (diagnostic.profileId !== profileId
		|| diagnostic.workloadId !== pipeline.workloadId
		|| diagnostic.fixtureId !== pipeline.fixtureId) {
		throw new Error(`${profileId} workload diagnostic names the wrong pipeline.`);
	}
	return diagnostic.measurement;
}

function cliInteger(value, maximum, label) {
	if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
		throw new Error(`5B collector ${label} must be a positive integer.`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > maximum) {
		throw new Error(`5B collector ${label} exceeds its ${maximum} maximum.`);
	}
	return parsed;
}

function validateFingerprint(value, platformId, profileId) {
	const record = exactRecord(value, FINGERPRINT_FIELDS, `${profileId} observedFingerprint`);
	if (record.platformId !== platformId) throw new Error(`${profileId} fingerprint platformId does not match.`);
	if (record.architecture !== PLATFORM_ARCHITECTURES[platformId]) {
		throw new Error(`${profileId} fingerprint architecture does not match its platform.`);
	}
	for (const field of ['osVersion', 'cpuModel', 'gpuModel', 'driverVersion']) {
		boundedString(record[field], 1, 512, `${profileId} fingerprint.${field}`);
	}
	for (const field of [
		'packageSha256', 'mediaHostSha256', 'workloadRunnerSha256',
		'ofxScannerSha256', 'ofxRuntimeHostSha256',
	]) {
		const digest = record[field];
		if (digest !== null && (typeof digest !== 'string' || !SHA256.test(digest))) {
			throw new Error(`${profileId} fingerprint.${field} must be a SHA-256 digest or null.`);
		}
	}
	if (!SHA256.test(record.packageSha256) || !SHA256.test(record.mediaHostSha256)) {
		throw new Error(`${profileId} measurement requires its package and media-host digests.`);
	}
	if (!SHA256.test(record.workloadRunnerSha256)) {
		throw new Error(`${profileId} measurement requires its workload-runner digest.`);
	}
	if (typeof record.sourceRevision !== 'string' || !SOURCE_REVISION.test(record.sourceRevision)) {
		throw new Error(`${profileId} fingerprint.sourceRevision must be a source revision.`);
	}
	if (profileId === 'openfx'
		&& (!SHA256.test(record.ofxScannerSha256) || !SHA256.test(record.ofxRuntimeHostSha256))) {
		throw new Error('OpenFX measurement requires scanner and runtime-host digests.');
	}
	return deepFreeze({ ...record });
}

function exactMetricRecord(value, metricIds, label, validate) {
	const record = requireRecord(value, label);
	const actual = Object.keys(record).sort();
	const expected = [...metricIds].sort();
	if (!sameStrings(actual, expected)) throw new Error(`${label} must contain the exact metric IDs.`);
	return deepFreeze(Object.fromEntries(metricIds.map((metricId) => [
		metricId,
		validate(record[metricId], `${label}.${metricId}`),
	])));
}

function assertRegistration(profileId, pipeline, workload) {
	if (!sameStrings(workload.fixtureIds, [pipeline.fixtureId])
		|| !Array.isArray(workload.thresholds)
		|| workload.thresholds.length === 0
		|| workload.thresholds.some((threshold) => (
			!isRecord(threshold)
			|| typeof threshold.metricId !== 'string'
			|| !['eq', 'gte', 'lte'].includes(threshold.comparison)
			|| !Number.isFinite(threshold.value)
			|| typeof threshold.unit !== 'string'
		))) {
		throw new Error(`Quality workload for ${profileId} does not own its exact fixture and measurements.`);
	}
}

function pipelineId(value) {
	if (typeof value !== 'string' || !Object.hasOwn(M5B_QUALITY_PIPELINES, value)) {
		throw new Error(`Unknown 5B quality pipeline ${String(value)}.`);
	}
	return value;
}

function platform(value, path) {
	if (typeof value !== 'string' || !Object.hasOwn(PLATFORM_ARCHITECTURES, value)) {
		throw new Error(`${path} is unsupported.`);
	}
	return value;
}

function finiteNonNegative(value, path) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be a finite non-negative number.`);
	}
	return value;
}

function positiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${path} must be a positive safe integer.`);
	return value;
}

function sameStrings(left, right) {
	return Array.isArray(left) && Array.isArray(right)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}

async function readMeasurementFile(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`5B measurement is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
	}
}
