/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	M5B_QUALITY_PIPELINES,
	m5bQualityBudgetSha256,
} from './m5b-quality-pipeline.mjs';
import { validateNativeOsDiagnosticBinding } from './native-os-diagnostics-schema.mjs';
import {
	deriveM5bQualityMetricsV2,
	validateM5bObservedRuntimeProfileV2,
} from './m5b-quality-observations-v2.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
} from './measurement-admission.mjs';
import {
	evaluateQualityWorkload,
	qualityWorkloadBudget,
} from './quality-budget-config.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../../config/quality-budgets.json', import.meta.url);
const DEFAULT_CONFIG = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
const ENVIRONMENT_ID = 'native-os-diagnostics';
const MEASUREMENT_FIELDS = Object.freeze([
	'schemaVersion', 'budgetSha256', 'sourceRevision', 'attemptCount', 'retryCount',
	'profileId', 'workloadId', 'fixtureId', 'environmentId', 'platformId',
	'diagnosticBinding', 'observations', 'observedRuntimeProfile',
]);
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const NATIVE_DIAGNOSTIC_ENVIRONMENT = Object.freeze({
	id: ENVIRONMENT_ID,
	status: 'active',
	kind: 'observed-native-runtime-diagnostics',
	rendererRequirement: 'any',
	evidence: Object.freeze(['scripts/lib/m5b-quality-pipeline-v2.mjs']),
});

export function validateM5bQualityMeasurementV2(
	profileIdValue,
	value,
	configValue = DEFAULT_CONFIG,
	expectedBudgetSha256 = m5bQualityBudgetSha256(configValue),
) {
	const profileId = pipelineId(profileIdValue);
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const config = snapshotStrictJsonData(configValue, 'quality config');
	const workload = qualityWorkloadBudget(config, pipeline.workloadId);
	assertRegistration(profileId, pipeline, workload);
	const record = exactRecord(
		snapshotStrictJsonData(value, `${profileId} V2 measurement`),
		MEASUREMENT_FIELDS,
		`${profileId} V2 measurement`,
	);
	if (record.schemaVersion !== 2) throw new Error(`${profileId} measurement schemaVersion must be 2.`);
	if (!SHA256.test(String(expectedBudgetSha256)) || record.budgetSha256 !== expectedBudgetSha256) {
		throw new Error(`${profileId} measurement budget digest does not match.`);
	}
	if (typeof record.sourceRevision !== 'string' || !SOURCE_REVISION.test(record.sourceRevision)) {
		throw new Error(`${profileId} measurement source revision is invalid.`);
	}
	if (record.attemptCount !== 1 || record.retryCount !== 0) {
		throw new Error(`${profileId} measurement must be one no-retry attempt.`);
	}
	if (record.profileId !== profileId
		|| record.workloadId !== pipeline.workloadId
		|| record.fixtureId !== pipeline.fixtureId
		|| record.environmentId !== ENVIRONMENT_ID) {
		throw new Error(`${profileId} measurement identity does not match its registered pipeline.`);
	}
	const diagnosticBinding = validateNativeOsDiagnosticBinding(
		record.diagnosticBinding, NATIVE_DIAGNOSTIC_ENVIRONMENT,
	);
	if (record.platformId !== diagnosticBinding.platformId) {
		throw new Error(`${profileId} measurement platform does not match its diagnostic binding.`);
	}
	if (diagnosticBinding.artifacts.sourceRevision !== record.sourceRevision) {
		throw new Error(`${profileId} source revision does not match its V2 artifact binding.`);
	}
	if (!SHA256.test(String(diagnosticBinding.artifacts.mediaHostSha256))) {
		throw new Error(`${profileId} measurement requires its media-host digest.`);
	}
	if (profileId === 'openfx' && (
		!SHA256.test(String(diagnosticBinding.artifacts.ofxScannerSha256))
		|| !SHA256.test(String(diagnosticBinding.artifacts.ofxRuntimeHostSha256))
	)) throw new Error('OpenFX measurement requires scanner and runtime-host digests.');
	const observedRuntimeProfile = validateM5bObservedRuntimeProfileV2(
		profileId,
		record.observedRuntimeProfile,
		diagnosticBinding,
	);
	const derived = deriveM5bQualityMetricsV2(record.observations, workload.thresholds);
	return deepFreeze({
		schemaVersion: 2,
		budgetSha256: expectedBudgetSha256,
		sourceRevision: record.sourceRevision,
		attemptCount: 1,
		retryCount: 0,
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: ENVIRONMENT_ID,
		platformId: diagnosticBinding.platformId,
		rendererClass: observedRuntimeProfile.rendererClass,
		diagnosticBinding,
		observedRuntimeProfile,
		observations: derived.observations,
		metrics: derived.metrics,
		sampleCounts: derived.sampleCounts,
	});
}

export function createM5bQualityResultV2(
	profileIdValue,
	measurementValue,
	configValue = DEFAULT_CONFIG,
	expectedBudgetSha256 = m5bQualityBudgetSha256(configValue),
) {
	const profileId = pipelineId(profileIdValue);
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const config = snapshotStrictJsonData(configValue, 'quality config');
	const measurement = validateM5bQualityMeasurementV2(
		profileId,
		measurementValue,
		configValue,
		expectedBudgetSha256,
	);
	const workload = qualityWorkloadBudget(config, pipeline.workloadId);
	const evaluation = evaluateQualityWorkload(config, workload, measurement.metrics);
	const metricGatePassed = evaluation.passed;
	const passed = metricGatePassed;
	return deepFreeze({
		schemaVersion: 2,
		status: passed ? 'passed' : 'failed',
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: ENVIRONMENT_ID,
		platformId: measurement.platformId,
		diagnosticPlatformId: measurement.diagnosticBinding.platformId,
		rendererClass: measurement.rendererClass,
		observedDiagnosticBinding: measurement.diagnosticBinding,
		observedRuntimeProfile: measurement.observedRuntimeProfile,
		metrics: measurement.metrics,
		sampleCounts: measurement.sampleCounts,
		metricGatePassed,
		evaluation,
	});
}

export async function writeM5bQualityResultV2(
	outputDirectoryValue,
	profileId,
	measurementValue,
	resultValue,
	configValue = DEFAULT_CONFIG,
	expectedBudgetSha256 = m5bQualityBudgetSha256(configValue),
) {
	const outputDirectory = boundedString(outputDirectoryValue, 1, 4_096, 'outputDirectory');
	const measurement = validateM5bQualityMeasurementV2(
		profileId, measurementValue, configValue, expectedBudgetSha256,
	);
	const expected = createM5bQualityResultV2(
		profileId, measurementValue, configValue, expectedBudgetSha256,
	);
	const result = snapshotStrictJsonData(resultValue, '5B V2 result');
	if (!isDeepStrictEqual(result, expected)) {
		throw new Error('5B V2 diagnostic result does not match its recomputed thresholds.');
	}
	const stem = `${expected.workloadId}.${measurement.diagnosticBinding.platformId}`;
	const rawBytes = Buffer.from(`${JSON.stringify(measurementValue, null, '\t')}\n`, 'utf8');
	const raw = Object.freeze({
		file: `${stem}.raw.json`,
		byteLength: rawBytes.byteLength,
		sha256: createHash('sha256').update(rawBytes).digest('hex'),
	});
	const boundResult = deepFreeze({ ...expected, raw });
	const resultBytes = Buffer.from(`${JSON.stringify(boundResult, null, '\t')}\n`, 'utf8');
	await mkdir(outputDirectory, { recursive: true });
	const rawPath = join(outputDirectory, raw.file);
	const resultPath = join(outputDirectory, `${stem}.${expected.status}.json`);
	await writeFile(rawPath, rawBytes, { flag: 'wx' });
	await writeFile(resultPath, resultBytes, { flag: 'wx' });
	return Object.freeze({ rawPath, resultPath, result: boundResult });
}

function assertRegistration(profileId, pipeline, workload) {
	if (!sameStrings(workload.fixtureIds, [pipeline.fixtureId])
		|| !Array.isArray(workload.thresholds)
		|| workload.thresholds.length === 0) {
		throw new Error(`Quality workload for ${profileId} does not own its exact registration.`);
	}
}

function pipelineId(value) {
	if (typeof value !== 'string' || !Object.hasOwn(M5B_QUALITY_PIPELINES, value)) {
		throw new Error(`Unknown 5B quality pipeline ${String(value)}.`);
	}
	return value;
}

function sameStrings(left, right) {
	return Array.isArray(left) && Array.isArray(right)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}
