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
	requireEqual(diagnostic?.environmentId, profile?.observedEnvironmentId, 'Observed environment ID is not qualified.', failures);
	requireEqual(workload?.environmentId, profile?.observedEnvironmentId, 'Workload environment ID is not qualified.', failures);
	requireEqual(diagnostic?.rendererClass, profile?.rendererClass, 'Diagnostic renderer class is not qualified.', failures);
	requireEqual(workload?.rendererClass, profile?.rendererClass, 'Workload renderer class is not qualified.', failures);
	if (!isDeepStrictEqual(diagnosticFingerprint(diagnostic), profile?.fingerprint)) {
		failures.push('Observed environment fingerprint does not match the owner-designated host.');
	}
	if (!isDeepStrictEqual(workload?.environmentFingerprint, profile?.fingerprint)) {
		failures.push('Workload environment fingerprint does not match the owner-designated host.');
	}
	if (workload?.metricGatePassed !== true) failures.push('The workload metric gate did not pass.');
	requireEqual(workload?.attemptCount, 1, 'The workload did not use one attempt.', failures);
	requireEqual(workload?.retryCount, 0, 'The workload did not use zero retries.', failures);
	verifyFixtureAndSamples(diagnostic, workload, profile, failures);
	verifyM1RawDiagnostic(diagnostic, workload, profile, failures);
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
		environmentFingerprint: diagnosticFingerprint(diagnostic),
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
	if (profile?.rawSampleCounts !== undefined
		&& !isDeepStrictEqual(workload?.rawSampleCounts, profile.rawSampleCounts)) {
		failures.push('Workload raw sampling counts do not match the qualification profile.');
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

function verifyM1RawDiagnostic(diagnostic, workload, profile, failures) {
	if (profile?.workloadId !== 'm1-video-preview-12fx-720p') return;
	if (!isDeepStrictEqual(diagnostic?.fixture, profile?.fixture)) {
		failures.push('Raw M1 fixture does not match the qualification profile.');
	}
	const expectedSampling = {
		warmupTrials: 1,
		measuredTrials: 5,
		measuredFramesPerTrial: 121,
		measuredIntervalsPerTrial: 120,
		forcedCollectionsPerSnapshot: 3,
	};
	if (!isDeepStrictEqual(diagnostic?.sampling, expectedSampling)) {
		failures.push('Raw M1 sampling contract does not match the qualification profile.');
	}
	const trials = Array.isArray(diagnostic?.trials) ? diagnostic.trials : [];
	const frameIntervals = [];
	const retainedHeapDeltas = [];
	let valid = trials.length === 5;
	for (let trialIndex = 0; trialIndex < trials.length; trialIndex += 1) {
		const trial = record(trials[trialIndex]);
		const timestamps = Array.isArray(trial?.frameTimestampsMs) ? trial.frameTimestampsMs : [];
		const heapBefore = record(trial?.heapBefore);
		const heapAfter = record(trial?.heapAfter);
		if (trial?.trial !== trialIndex + 1 || timestamps.length !== 121
			|| timestamps.some((value) => typeof value !== 'number' || !Number.isFinite(value))
			|| trial?.forcedCollectionsBefore !== 3 || trial?.forcedCollectionsAfter !== 3
			|| !validHeapSnapshot(heapBefore) || !validHeapSnapshot(heapAfter)) {
			valid = false;
			continue;
		}
		for (let frameIndex = 1; frameIndex < timestamps.length; frameIndex += 1) {
			const interval = timestamps[frameIndex] - timestamps[frameIndex - 1];
			if (!Number.isFinite(interval) || interval <= 0) valid = false;
			else frameIntervals.push(interval);
		}
		retainedHeapDeltas.push(heapAfter.usedSize - heapBefore.usedSize);
	}
	const observedCounts = {
		warmupTrials: 1,
		measuredTrials: trials.length,
		measuredFrames: trials.reduce((sum, value) => (
			sum + (Array.isArray(record(value)?.frameTimestampsMs) ? value.frameTimestampsMs.length : 0)
		), 0),
		measuredIntervals: frameIntervals.length,
		forcedCollectionsBefore: trials.reduce((sum, value) => sum + Number(record(value)?.forcedCollectionsBefore ?? 0), 0),
		forcedCollectionsAfter: trials.reduce((sum, value) => sum + Number(record(value)?.forcedCollectionsAfter ?? 0), 0),
		heapSnapshotsBefore: trials.filter((value) => record(record(value)?.heapBefore) !== null).length,
		heapSnapshotsAfter: trials.filter((value) => record(record(value)?.heapAfter) !== null).length,
	};
	if (!valid || !isDeepStrictEqual(observedCounts, profile?.rawSampleCounts)) {
		failures.push('Raw M1 trials do not match the qualified sampling counts.');
		return;
	}
	const derivedMetrics = {
		'preview.frameIntervalP95Ms': roundedMetric(nearestRankP95(frameIntervals)),
		'preview.retainedJsHeapDeltaBytes': roundedMetric(nearestRankP95(retainedHeapDeltas)),
	};
	if (!isDeepStrictEqual(workload?.metrics, derivedMetrics)) {
		failures.push('M1 summary metrics do not match the retained raw samples.');
	}
}

function diagnosticFingerprint(diagnostic) {
	if (diagnostic === null) return null;
	return diagnostic.environmentFingerprint ?? null;
}

function validHeapSnapshot(snapshot) {
	return typeof snapshot?.usedSize === 'number' && Number.isFinite(snapshot.usedSize) && snapshot.usedSize >= 0
		&& typeof snapshot?.totalSize === 'number' && Number.isFinite(snapshot.totalSize)
		&& snapshot.totalSize >= snapshot.usedSize;
}

function nearestRankP95(samples) {
	const sorted = samples.toSorted((left, right) => left - right);
	return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function roundedMetric(value) {
	return Number(value.toFixed(9));
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
