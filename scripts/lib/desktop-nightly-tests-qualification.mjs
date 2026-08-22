/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const M4_WORKLOAD_ID = 'm4-production-render-parity';
const SHA256 = /^[a-f\d]{64}$/u;
const SOURCE_REVISION = /^[a-f\d]{40}$/u;

/**
 * Admit independently complete workloads from the owner-designated packaged
 * host without coupling their verdicts to unrelated Playwright failures.
 */
export function createPackagedRuntimeQualification({ config, raw, summary } = {}) {
	const qualification = record(config?.packagedRuntimeQualification);
	const profiles = Array.isArray(qualification?.profiles)
		? qualification.profiles.map(record).filter((value) => value !== null)
		: qualification === null ? [] : [qualification];
	const workloadQualifications = profiles.map((profile) => createWorkloadQualification({
		config, raw, summary, profile, qualification,
	}));
	const primary = workloadQualifications.find(({ workloadId }) => workloadId === M4_WORKLOAD_ID)
		?? workloadQualifications[0]
		?? rejectedQualification(summary, 'No packaged-runtime qualification profile is registered.');
	return Object.freeze({
		...primary,
		kind: 'soundscaper-packaged-runtime-formal-qualification',
		workloadQualifications: Object.freeze(workloadQualifications),
	});
}

function createWorkloadQualification({ config, raw, summary, profile, qualification }) {
	const failures = [];
	const diagnostics = record(raw?.diagnostics);
	const diagnosticKey = typeof profile?.diagnosticKey === 'string'
		? profile.diagnosticKey
		: profile?.workloadId === M4_WORKLOAD_ID ? 'm4-production-parity' : profile?.workloadId;
	const diagnostic = record(diagnostics?.[diagnosticKey]);
	const workloads = Array.isArray(summary?.workloads) ? summary.workloads : [];
	const matches = workloads.filter((value) => record(value)?.workloadId === profile?.workloadId);
	const workload = matches.length === 1 ? record(matches[0]) : null;

	requireEqual(qualification?.status, 'active', 'Qualification collection is not active.', failures);
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
	if (matches.length !== 1) failures.push('Qualification requires exactly one registered workload result.');

	for (const field of ['workloadId', 'fixtureId', 'profile', 'observationClass']) {
		if (profile?.[field] === undefined) continue;
		requireEqual(workload?.[field], profile[field], `Workload ${field} does not match the qualification profile.`, failures);
	}
	const diagnosticIdentityFields = Array.isArray(profile?.diagnosticIdentityFields)
		? profile.diagnosticIdentityFields
		: ['workloadId', 'fixtureId', 'profile', 'observationClass'];
	for (const field of diagnosticIdentityFields) {
		requireEqual(diagnostic?.[field], profile?.[field], `Diagnostic ${field} does not match the qualification profile.`, failures);
	}
	if (profile?.diagnosticFingerprintSource !== 'm1-video-preview') {
		requireEqual(diagnostic?.environmentId, profile?.observedEnvironmentId, 'Observed environment ID is not qualified.', failures);
	}
	requireEqual(workload?.environmentId, profile?.observedEnvironmentId, 'Workload environment ID is not qualified.', failures);
	requireEqual(diagnosticRendererClass(diagnostic, profile), profile?.rendererClass, 'Diagnostic renderer class is not qualified.', failures);
	requireEqual(workload?.rendererClass, profile?.rendererClass, 'Workload renderer class is not qualified.', failures);
	if (!isDeepStrictEqual(diagnosticFingerprint(diagnostic, profile), profile?.fingerprint)) {
		failures.push('Observed environment fingerprint does not match the owner-designated host.');
	}
	if (!isDeepStrictEqual(workload?.environmentFingerprint, profile?.fingerprint)) {
		failures.push('Workload environment fingerprint does not match the owner-designated host.');
	}
	if (workload?.metricGatePassed !== true) failures.push('The workload metric gate did not pass.');
	requireEqual(workload?.attemptCount, 1, 'The workload did not use one attempt.', failures);
	requireEqual(workload?.retryCount, 0, 'The workload did not use zero retries.', failures);
	verifyFixtureAndSamples(diagnostic, workload, profile, failures);
	const thresholds = registeredThresholds(config, profile?.workloadId);
	const verdicts = Array.isArray(workload?.evaluation?.verdicts) ? workload.evaluation.verdicts : [];
	if (thresholds === null) {
		failures.push('The registered threshold set is unavailable.');
	} else if (verdicts.length !== thresholds.length
		|| thresholds.some((threshold) => verdicts.filter((verdict) => (
			record(verdict)?.metricId === record(threshold)?.metricId && record(verdict)?.passed === true
		)).length !== 1)) {
		failures.push('Every registered threshold must have exactly one passing verdict.');
	}

	const passed = failures.length === 0;
	const diagnosticSha256 = diagnostic === null
		? null
		: createHash('sha256').update(JSON.stringify(diagnostic)).digest('hex');
	return Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-packaged-runtime-workload-formal-qualification',
		status: passed ? 'accepted' : 'rejected',
		qualificationEvidencePublished: passed,
		environmentId: typeof profile?.environmentId === 'string' ? profile.environmentId : null,
		observedEnvironmentId: typeof workload?.environmentId === 'string' ? workload.environmentId : null,
		workloadId: typeof profile?.workloadId === 'string' ? profile.workloadId : null,
		fixtureId: typeof profile?.fixtureId === 'string' ? profile.fixtureId : null,
		sourceRevision: typeof summary?.sourceRevision === 'string' ? summary.sourceRevision : null,
		budgetSha256: typeof summary?.budgetSha256 === 'string' ? summary.budgetSha256 : null,
		attemptCount: 1,
		retryCount: 0,
		workerCount: 1,
		rendererClass: typeof workload?.rendererClass === 'string' ? workload.rendererClass : null,
		environmentFingerprint: diagnosticFingerprint(diagnostic, profile),
		metrics: workload?.metrics ?? null,
		rawEvidence: Object.freeze({
			artifactName: 'raw.json',
			diagnosticKey: typeof diagnosticKey === 'string' ? diagnosticKey : null,
			diagnosticSha256,
		}),
		verification: Object.freeze({ passed, failures: Object.freeze(failures) }),
	});
}

function verifyFixtureAndSamples(diagnostic, workload, profile, failures) {
	if (profile?.fixture !== undefined && !isDeepStrictEqual(workload?.fixture, profile.fixture)) {
		failures.push('Workload fixture summary does not match the qualification profile.');
	}
	const sampleShape = record(profile?.sampleShape);
	if (sampleShape === null) return;
	const observedShape = {
		resolution: diagnostic?.resolution,
		effects: diagnostic?.effects,
		warmupFrames: diagnostic?.warmupFrames,
		measuredFrames: diagnostic?.measuredFrames,
		measuredIntervals: diagnostic?.measuredIntervals,
	};
	if (!isDeepStrictEqual(observedShape, sampleShape)) {
		failures.push('Raw sampling shape does not match the qualification profile.');
	}
	const expectedCounts = {
		warmupFrames: sampleShape.warmupFrames,
		measuredFrames: sampleShape.measuredFrames,
		measuredIntervals: sampleShape.measuredIntervals,
	};
	if (!isDeepStrictEqual(workload?.rawSampleCounts, expectedCounts)) {
		failures.push('Workload sampling counts do not match the qualification profile.');
	}
}

function diagnosticFingerprint(diagnostic, profile) {
	if (diagnostic === null) return null;
	if (profile?.diagnosticFingerprintSource === 'm1-video-preview') {
		return {
			browserVersion: diagnostic.browserVersion,
			browserEnvironment: diagnostic.browserEnvironment,
			renderer: diagnostic.renderer,
		};
	}
	return diagnostic.environmentFingerprint ?? null;
}

function diagnosticRendererClass(diagnostic, profile) {
	if (profile?.diagnosticFingerprintSource !== 'm1-video-preview') return diagnostic?.rendererClass;
	const renderer = record(diagnostic?.renderer);
	const description = `${String(renderer?.vendor ?? '')} ${String(renderer?.renderer ?? '')}`;
	return /swiftshader|llvmpipe|software|offscreen/iu.test(description) ? 'software' : 'hardware';
}

function rejectedQualification(summary, failure) {
	return Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-packaged-runtime-workload-formal-qualification',
		status: 'rejected',
		qualificationEvidencePublished: false,
		environmentId: null,
		observedEnvironmentId: null,
		workloadId: null,
		fixtureId: null,
		sourceRevision: typeof summary?.sourceRevision === 'string' ? summary.sourceRevision : null,
		budgetSha256: typeof summary?.budgetSha256 === 'string' ? summary.budgetSha256 : null,
		attemptCount: 1,
		retryCount: 0,
		workerCount: 1,
		rendererClass: null,
		environmentFingerprint: null,
		metrics: null,
		rawEvidence: Object.freeze({ artifactName: 'raw.json', diagnosticKey: null, diagnosticSha256: null }),
		verification: Object.freeze({ passed: false, failures: Object.freeze([failure]) }),
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
