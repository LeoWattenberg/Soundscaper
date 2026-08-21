/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const WORKLOAD_KEY = 'm4-production-parity';
const SHA256 = /^[a-f\d]{64}$/u;
const SOURCE_REVISION = /^[a-f\d]{40}$/u;

/**
 * Admit the owner-designated packaged host without coupling Soundscaper's M4
 * verdict to unrelated Framescaper workloads in the same Playwright process.
 */
export function createPackagedRuntimeQualification({ config, raw, summary } = {}) {
	const failures = [];
	const profile = record(config?.packagedRuntimeQualification);
	const diagnostics = record(raw?.diagnostics);
	const diagnostic = record(diagnostics?.[WORKLOAD_KEY]);
	const workloads = Array.isArray(summary?.workloads) ? summary.workloads : [];
	const matches = workloads.filter((value) => record(value)?.workloadId === profile?.workloadId);
	const workload = matches.length === 1 ? record(matches[0]) : null;

	requireEqual(profile?.status, 'active', 'Qualification profile is not active.', failures);
	requireString(profile?.environmentId, 'Qualification environment ID is unavailable.', failures);
	requireEqual(raw?.schemaVersion, 1, 'Raw evidence schema is invalid.', failures);
	requireEqual(summary?.schemaVersion, 1, 'Summary schema is invalid.', failures);
	requireEqual(raw?.executionSurface, 'packaged-runtime', 'Raw evidence is not packaged-runtime evidence.', failures);
	requireEqual(summary?.executionSurface, 'packaged-runtime', 'Summary is not packaged-runtime evidence.', failures);
	requireEqual(raw?.sourceRevision, summary?.sourceRevision, 'Evidence source revisions disagree.', failures);
	if (typeof summary?.sourceRevision !== 'string' || !SOURCE_REVISION.test(summary.sourceRevision)) {
		failures.push('Qualification requires a complete source revision.');
	}
	requireEqual(raw?.budgetSha256, summary?.budgetSha256, 'Evidence budget digests disagree.', failures);
	if (typeof summary?.budgetSha256 !== 'string' || !SHA256.test(summary.budgetSha256)) {
		failures.push('Qualification requires a valid budget digest.');
	}
	requireEqual(summary?.attemptCount, 1, 'Qualification requires one attempt.', failures);
	requireEqual(summary?.retryCount, 0, 'Qualification requires zero retries.', failures);
	requireEqual(summary?.workerCount, 1, 'Qualification requires one worker.', failures);
	if (matches.length !== 1) failures.push('Qualification requires exactly one M4 workload result.');

	for (const field of ['workloadId', 'fixtureId', 'profile', 'observationClass']) {
		requireEqual(diagnostic?.[field], profile?.[field], `Diagnostic ${field} does not match the qualification profile.`, failures);
		requireEqual(workload?.[field], profile?.[field], `Workload ${field} does not match the qualification profile.`, failures);
	}
	requireEqual(diagnostic?.environmentId, profile?.observedEnvironmentId, 'Observed environment ID is not qualified.', failures);
	requireEqual(workload?.environmentId, profile?.observedEnvironmentId, 'Workload environment ID is not qualified.', failures);
	requireEqual(diagnostic?.rendererClass, profile?.rendererClass, 'Diagnostic renderer class is not qualified.', failures);
	requireEqual(workload?.rendererClass, profile?.rendererClass, 'Workload renderer class is not qualified.', failures);
	if (!isDeepStrictEqual(diagnostic?.environmentFingerprint, profile?.fingerprint)) {
		failures.push('Observed environment fingerprint does not match the owner-designated host.');
	}
	if (!isDeepStrictEqual(workload?.environmentFingerprint, profile?.fingerprint)) {
		failures.push('Workload environment fingerprint does not match the owner-designated host.');
	}
	if (workload?.metricGatePassed !== true) failures.push('The M4 metric gate did not pass.');
	requireEqual(workload?.attemptCount, 1, 'The M4 workload did not use one attempt.', failures);
	requireEqual(workload?.retryCount, 0, 'The M4 workload did not use zero retries.', failures);
	const thresholds = registeredThresholds(config, profile?.workloadId);
	const verdicts = Array.isArray(workload?.evaluation?.verdicts) ? workload.evaluation.verdicts : [];
	if (thresholds === null) {
		failures.push('The registered M4 threshold set is unavailable.');
	} else if (verdicts.length !== thresholds.length
		|| thresholds.some((threshold) => !verdicts.some((verdict) => (
			record(verdict)?.metricId === record(threshold)?.metricId && record(verdict)?.passed === true
		)))) {
		failures.push('Every registered M4 threshold must have one passing verdict.');
	}

	const passed = failures.length === 0;
	const diagnosticSha256 = diagnostic === null
		? null
		: createHash('sha256').update(JSON.stringify(diagnostic)).digest('hex');
	return Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-packaged-runtime-formal-qualification',
		status: passed ? 'accepted' : 'rejected',
		qualificationEvidencePublished: passed,
		environmentId: typeof profile?.environmentId === 'string' ? profile.environmentId : null,
		observedEnvironmentId: typeof diagnostic?.environmentId === 'string' ? diagnostic.environmentId : null,
		workloadId: typeof profile?.workloadId === 'string' ? profile.workloadId : null,
		fixtureId: typeof profile?.fixtureId === 'string' ? profile.fixtureId : null,
		sourceRevision: typeof summary?.sourceRevision === 'string' ? summary.sourceRevision : null,
		budgetSha256: typeof summary?.budgetSha256 === 'string' ? summary.budgetSha256 : null,
		attemptCount: 1,
		retryCount: 0,
		workerCount: 1,
		rendererClass: typeof diagnostic?.rendererClass === 'string' ? diagnostic.rendererClass : null,
		environmentFingerprint: diagnostic?.environmentFingerprint ?? null,
		metrics: workload?.metrics ?? null,
		rawEvidence: Object.freeze({
			artifactName: 'raw.json',
			diagnosticKey: WORKLOAD_KEY,
			diagnosticSha256,
		}),
		verification: Object.freeze({ passed, failures: Object.freeze(failures) }),
	});
}

function registeredThresholds(config, workloadId) {
	if (!Array.isArray(config?.workloads) || typeof workloadId !== 'string') return null;
	const matches = config.workloads.filter((value) => record(value)?.id === workloadId);
	return matches.length === 1 && Array.isArray(matches[0].thresholds) ? matches[0].thresholds : null;
}

function requireEqual(actual, expected, failure, failures) {
	if (!isDeepStrictEqual(actual, expected)) failures.push(failure);
}

function requireString(value, failure, failures) {
	if (typeof value !== 'string' || value.length < 1) failures.push(failure);
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
