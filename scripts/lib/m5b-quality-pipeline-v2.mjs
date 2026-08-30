/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { evaluateQualityBudget } from '../quality-budget-evaluator.mjs';
import {
	M5B_QUALITY_PIPELINES,
	m5bQualityBudgetSha256,
} from './m5b-quality-pipeline.mjs';
import {
	assessNativeOsLabBindingQualificationV2,
	validateNativeOsLabMeasurementBindingV2,
} from './native-os-lab-schema.mjs';
import {
	deriveM5bQualityMetricsV2,
	validateM5bObservedRuntimeProfileV2,
} from './m5b-quality-observations-v2.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
	isRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../../config/quality-budgets.json', import.meta.url);
const DEFAULT_CONFIG = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
const ENVIRONMENT_ID = 'native-os-lab-matrix';
const MEASUREMENT_FIELDS = Object.freeze([
	'schemaVersion', 'budgetSha256', 'sourceRevision', 'attemptCount', 'retryCount',
	'profileId', 'workloadId', 'fixtureId', 'environmentId', 'platformId',
	'labBinding', 'observations', 'observedRuntimeProfile',
]);
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function validateM5bQualityMeasurementV2(
	profileIdValue,
	value,
	configValue = DEFAULT_CONFIG,
	expectedBudgetSha256 = m5bQualityBudgetSha256(configValue),
) {
	const profileId = pipelineId(profileIdValue);
	const pipeline = M5B_QUALITY_PIPELINES[profileId];
	const config = snapshotStrictJsonData(configValue, 'quality config');
	const workload = exactDescriptor(config.workloads, pipeline.workloadId, 'workload');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
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
	if (record.attemptCount !== 1 || record.retryCount !== 0
		|| config.measurementPolicy?.benchmarkRetries !== 0) {
		throw new Error(`${profileId} measurement must be one no-retry attempt.`);
	}
	if (record.profileId !== profileId
		|| record.workloadId !== pipeline.workloadId
		|| record.fixtureId !== pipeline.fixtureId
		|| record.environmentId !== ENVIRONMENT_ID) {
		throw new Error(`${profileId} measurement identity does not match its registered pipeline.`);
	}
	const labBinding = validateNativeOsLabMeasurementBindingV2(record.labBinding, environment);
	if (record.platformId !== labBinding.platformId) {
		throw new Error(`${profileId} measurement platform does not match its V2 lab binding.`);
	}
	if (labBinding.profile.productId !== 'framescaper'
		|| labBinding.profile.mediaDecodeBackend === null
		|| labBinding.profile.mediaEncodeBackend === null) {
		throw new Error(`${profileId} V2 lab binding must use a Framescaper media profile.`);
	}
	if (labBinding.artifacts.sourceRevision !== record.sourceRevision) {
		throw new Error(`${profileId} source revision does not match its V2 artifact binding.`);
	}
	if (!SHA256.test(String(labBinding.artifacts.mediaHostSha256))) {
		throw new Error(`${profileId} measurement requires its media-host digest.`);
	}
	if (profileId === 'openfx' && (
		!SHA256.test(String(labBinding.artifacts.ofxScannerSha256))
		|| !SHA256.test(String(labBinding.artifacts.ofxRuntimeHostSha256))
	)) throw new Error('OpenFX measurement requires scanner and runtime-host digests.');
	const observedRuntimeProfile = validateM5bObservedRuntimeProfileV2(
		profileId,
		record.observedRuntimeProfile,
		labBinding,
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
		platformId: labBinding.platformId,
		rendererClass: observedRuntimeProfile.rendererClass,
		labBinding,
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
	const workload = exactDescriptor(config.workloads, pipeline.workloadId, 'workload');
	const fixture = exactDescriptor(config.fixtures, pipeline.fixtureId, 'fixture');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const assessment = assessNativeOsLabBindingQualificationV2(
		environment,
		measurementValue.labBinding,
		pipeline.workloadId,
	);
	const blockers = [...assessment.blockers];
	if (fixture.status !== 'qualified') blockers.push(`Fixture ${fixture.id} status is ${String(fixture.status)}.`);
	if (workload.status !== 'qualified') blockers.push(`Workload ${workload.id} status is ${String(workload.status)}.`);
	if (!Array.isArray(config.qualification?.qualifiedWorkloadIds)
		|| !config.qualification.qualifiedWorkloadIds.includes(workload.id)) {
		blockers.push(`Workload ${workload.id} has no accepted qualification cohort.`);
	}
	const evaluation = evaluateQualityBudget({
		environmentId: ENVIRONMENT_ID,
		rendererRequirement: environment.rendererRequirement,
		thresholds: workload.thresholds,
	}, environment, measurement);
	const metricGatePassed = evaluation.verdicts.length === workload.thresholds.length
		&& evaluation.verdicts.every(({ passed }) => passed);
	const accepted = metricGatePassed && evaluation.passed && blockers.length === 0;
	return deepFreeze({
		schemaVersion: 2,
		qualificationScope: 'single-profile',
		status: !metricGatePassed ? 'failed' : accepted ? 'accepted' : 'pending-external',
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: ENVIRONMENT_ID,
		platformId: measurement.platformId,
		labProfileId: measurement.labBinding.profileId,
		rendererClass: measurement.rendererClass,
		observedLabBinding: measurement.labBinding,
		observedRuntimeProfile: measurement.observedRuntimeProfile,
		metrics: measurement.metrics,
		sampleCounts: measurement.sampleCounts,
		metricGatePassed,
		qualificationEvidencePublished: false,
		qualificationBlockers: [...new Set(blockers)],
		evaluation: {
			passed: accepted,
			failures: [...new Set([...evaluation.failures, ...blockers])],
			verdicts: evaluation.verdicts,
		},
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
		throw new Error('5B V2 result does not match its recomputed qualification result.');
	}
	const stem = `${expected.workloadId}.${measurement.labBinding.profileId}`;
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
		|| !sameStrings(workload.environmentIds, [ENVIRONMENT_ID])
		|| !Array.isArray(workload.thresholds)
		|| workload.thresholds.length === 0) {
		throw new Error(`Quality workload for ${profileId} does not own its exact registration.`);
	}
}

function exactDescriptor(collection, id, label) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
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
