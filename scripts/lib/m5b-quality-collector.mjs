/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	M5B_QUALITY_PIPELINES,
	assertM5bCollectionHost,
	createM5bQualityResult,
	parseM5bQualityCollectorCliArguments,
	validateM5bQualityMeasurement,
	writeM5bQualityResult,
} from './m5b-quality-pipeline.mjs';
import {
	createM5bQualityResultV2,
	validateM5bQualityMeasurementV2,
	writeM5bQualityResultV2,
} from './m5b-quality-pipeline-v2.mjs';
import {
	fingerprintM5bWorkloadExecutable,
	runM5bQualityWorkload,
} from './m5b-quality-workload-runner.mjs';
import { exactRecord, requireRecord } from './measurement-validation.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../../config/quality-budgets.json', import.meta.url);
const DIAGNOSTIC_FIELDS = Object.freeze([
	'schemaVersion', 'diagnosticType', 'profileId', 'workloadId', 'fixtureId', 'measurement',
]);
const DIAGNOSTIC_TYPE = 'soundscaper.m5b-quality-workload-diagnostic';

export async function collectM5bQualityCurrent(profileId, options, dependencies = {}) {
	assertM5bCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	if (options.measurementPath !== null) {
		const measurement = await (dependencies.readMeasurement ?? readMeasurement)(options.measurementPath);
		return collectAdmitted(profileId, measurement, options.outputDirectory, config, dependencies);
	}
	const command = options.workloadCommand;
	const fingerprintExecutable = dependencies.fingerprintExecutable ?? fingerprintM5bWorkloadExecutable;
	const before = await fingerprintExecutable(command.executable);
	const diagnostic = await (dependencies.runWorkload ?? runM5bQualityWorkload)(command);
	const after = await fingerprintExecutable(command.executable);
	if (after !== before) throw new Error('5B workload executable changed while its measurement was collected.');
	const measurement = measurementFromDiagnostic(profileId, diagnostic);
	const runnerDigest = measurement.schemaVersion === 2
		? measurement.diagnosticBinding?.artifacts?.workloadRunnerSha256
		: measurement.observedFingerprint?.workloadRunnerSha256;
	if (runnerDigest !== before) {
		throw new Error('5B workload runner executable digest does not match the measured artifact binding.');
	}
	return collectAdmitted(profileId, measurement, options.outputDirectory, config, dependencies);
}

export async function runM5bQualityCollectorCli(profileId) {
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
	const outputDirectory = resolve(options.outputDirectory ?? fileURLToPath(
		new URL(`../../test-results/quality/m5b-${profileId}`, import.meta.url),
	));
	const collected = await collectM5bQualityCurrent(profileId, {
		measurementPath: options.measurementPath === null ? null : resolve(options.measurementPath),
		workloadCommand: options.workloadCommand,
		outputDirectory,
	});
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status === 'failed') process.exitCode = 1;
}

async function collectAdmitted(profileId, measurement, outputDirectory, config, dependencies) {
	if (measurement?.schemaVersion === 2) {
		validateM5bQualityMeasurementV2(profileId, measurement, config);
		const result = createM5bQualityResultV2(profileId, measurement, config);
		return (dependencies.writeV2Result ?? writeM5bQualityResultV2)(
			outputDirectory,
			profileId,
			measurement,
			result,
			config,
		);
	}
	const validated = validateM5bQualityMeasurement(profileId, measurement, config);
	const result = createM5bQualityResult(profileId, validated, config);
	return (dependencies.writeV1Result ?? writeM5bQualityResult)(
		outputDirectory,
		validated,
		result,
		config,
	);
}

function measurementFromDiagnostic(profileId, value) {
	if (!Object.hasOwn(M5B_QUALITY_PIPELINES, profileId)) {
		throw new Error(`Unknown 5B quality pipeline ${String(profileId)}.`);
	}
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const diagnostic = exactRecord(
		snapshotStrictJsonData(value, `${profileId} workload diagnostic`),
		DIAGNOSTIC_FIELDS,
		`${profileId} workload diagnostic`,
	);
	if (![1, 2].includes(diagnostic.schemaVersion) || diagnostic.diagnosticType !== DIAGNOSTIC_TYPE) {
		throw new Error(`${profileId} workload diagnostic protocol is unsupported.`);
	}
	if (diagnostic.profileId !== profileId
		|| diagnostic.workloadId !== pipeline.workloadId
		|| diagnostic.fixtureId !== pipeline.fixtureId) {
		throw new Error(`${profileId} workload diagnostic names the wrong pipeline.`);
	}
	return requireRecord(diagnostic.measurement, `${profileId} workload diagnostic measurement`);
}

async function readMeasurement(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`5B measurement is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
	}
}
