/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateQualityBudget } from './quality-budget-evaluator.mjs';

const RESULT_FIELDS = Object.freeze([
	'attemptCount',
	'budgetSha256',
	'environmentFingerprint',
	'environmentId',
	'fixtureIds',
	'metrics',
	'rawArtifact',
	'rendererClass',
	'retryCount',
	'schemaVersion',
	'sourceRevision',
	'workloadId',
]);
const RAW_ARTIFACT_FIELDS = Object.freeze(['artifactName', 'byteLength', 'sha256']);
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const SOURCE_REVISION_PATTERN = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z\d][A-Za-z\d._-]{0,126}\.json$/u;

/**
 * Evaluate one retained, digest-bound measurement summary against its exact
 * workload and environment descriptors.
 *
 * The result is snapshotted exclusively through own data descriptors before
 * any field is interpreted. Accessor-backed or exotic records are refused
 * without invoking user code.
 *
 * @param {{
 *   workload: {
 *     id: string,
 *     fixtureIds: readonly string[],
 *     thresholds: readonly {
 *       metricId: string,
 *       behavior: 'blocking' | 'observational',
 *       comparison: 'eq' | 'gte' | 'lte',
 *       value: number,
 *       unit: string,
 *     }[],
 *   },
 *   expectedBudgetSha256: string,
 * }} expectation
 * @param {unknown} candidate
 */
export function evaluateQualityBudgetResult(expectation, candidate) {
	const snapshotFailures = [];
	const result = snapshotOwnData(candidate, 'result', snapshotFailures);
	if (!isRecord(result)) {
		if (snapshotFailures.length === 0) snapshotFailures.push('Result must be a plain record.');
		return failedEvaluation(snapshotFailures);
	}
	if (snapshotFailures.length > 0) return failedEvaluation(snapshotFailures);

	const failures = [];
	assertExactFields(result, RESULT_FIELDS, 'result', failures);
	if (result.schemaVersion !== 1) failures.push('Result schema version must be 1.');
	if (result.workloadId !== expectation.workload.id) {
		failures.push(
			`Result workload ${String(result.workloadId)} does not match ${expectation.workload.id}.`,
		);
	}
	if (!sameStringArray(result.fixtureIds, expectation.workload.fixtureIds)) {
		failures.push('Result fixture IDs do not exactly match the workload fixture IDs.');
	}
	if (typeof result.environmentId !== 'string' || result.environmentId.length === 0) {
		failures.push('Result environment ID must describe the runtime that produced it.');
	}
	if (!isRecord(result.environmentFingerprint)
		|| Object.keys(result.environmentFingerprint).length === 0) {
		failures.push('Result environment fingerprint must retain the observed runtime context.');
	}
	if (!SHA256_PATTERN.test(expectation.expectedBudgetSha256)
		|| result.budgetSha256 !== expectation.expectedBudgetSha256) {
		failures.push('Result budget digest does not match the expected SHA-256.');
	}
	if (typeof result.sourceRevision !== 'string'
		|| !SOURCE_REVISION_PATTERN.test(result.sourceRevision)) {
		failures.push('Result source revision must be one lowercase Git object ID.');
	}
	if (result.attemptCount !== 1) {
		failures.push('Result must represent exactly one no-retry attempt.');
	}
	if (result.retryCount !== 0) {
		failures.push('Result retry count must be zero.');
	}
	if (!['hardware', 'software', 'unknown'].includes(result.rendererClass)) {
		failures.push('Result renderer class must be hardware, software, or unknown.');
	}

	validateRawArtifact(result.rawArtifact, failures);
	validateMetrics(result.metrics, expectation.workload.thresholds, failures);

	const metricEvaluation = evaluateQualityBudget(
		expectation.workload.thresholds,
		isRecord(result.metrics) ? result.metrics : {},
	);

	return Object.freeze({
		passed: failures.length === 0 && metricEvaluation.passed,
		failures: Object.freeze([...failures, ...metricEvaluation.failures]),
		warnings: metricEvaluation.warnings,
		verdicts: metricEvaluation.verdicts,
	});
}

function validateRawArtifact(value, failures) {
	if (!isRecord(value)) {
		failures.push('Result raw artifact must be a plain record.');
		return;
	}
	assertExactFields(value, RAW_ARTIFACT_FIELDS, 'raw artifact', failures);
	if (typeof value.artifactName !== 'string' || !ARTIFACT_NAME_PATTERN.test(value.artifactName)) {
		failures.push('Result raw artifact name must be one local JSON filename.');
	}
	if (!Number.isSafeInteger(value.byteLength) || value.byteLength <= 0) {
		failures.push('Result raw artifact byte length must be a positive safe integer.');
	}
	if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
		failures.push('Result raw artifact digest must be one lowercase SHA-256.');
	}
}

function validateMetrics(value, thresholds, failures) {
	if (!isRecord(value)) {
		failures.push('Result metrics must be a plain record.');
		return;
	}
	const expectedIds = thresholds.map(({ metricId }) => metricId).sort();
	const actualIds = Object.keys(value).sort();
	if (!sameStringArray(actualIds, expectedIds)) {
		failures.push('Result metrics must contain the exact threshold metric set.');
	}
}

function assertExactFields(value, expectedFields, label, failures) {
	const actualFields = Object.keys(value).sort();
	const sortedExpected = [...expectedFields].sort();
	if (!sameStringArray(actualFields, sortedExpected)) {
		failures.push(`${capitalize(label)} must contain the exact ${label} fields.`);
	}
}

function snapshotOwnData(value, path, failures) {
	if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return value;
	if (typeof value !== 'object') {
		failures.push(`${capitalize(path)} must contain only JSON data.`);
		return undefined;
	}

	if (Array.isArray(value)) return snapshotArray(value, path, failures);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		failures.push(`${capitalize(path)} must be a plain record with own data properties.`);
		return undefined;
	}
	const snapshot = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			failures.push(`${capitalize(path)} must contain only string-keyed own data properties.`);
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			failures.push(`${capitalize(path)} must contain only own data properties.`);
			continue;
		}
		snapshot[key] = snapshotOwnData(descriptor.value, `${path}.${key}`, failures);
	}
	return snapshot;
}

function snapshotArray(value, path, failures) {
	const snapshot = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			failures.push(`${capitalize(path)} must be a dense array of own data properties.`);
			continue;
		}
		snapshot.push(snapshotOwnData(descriptor.value, `${path}[${index}]`, failures));
	}
	const unexpectedKeys = Reflect.ownKeys(value).filter((key) => {
		if (key === 'length') return false;
		return typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length;
	});
	if (unexpectedKeys.length > 0) {
		failures.push(`${capitalize(path)} must contain only indexed own data properties.`);
	}
	return snapshot;
}

function sameStringArray(left, right) {
	return Array.isArray(left)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failedEvaluation(failures) {
	return Object.freeze({
		passed: false,
		failures: Object.freeze([...failures]),
		warnings: Object.freeze([]),
		verdicts: Object.freeze([]),
	});
}

function capitalize(value) {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
