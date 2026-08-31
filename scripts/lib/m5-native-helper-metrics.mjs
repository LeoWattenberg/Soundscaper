/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	boundedString,
	deepFreeze,
	exactRecord,
	nonNegativeInteger,
	positiveInteger,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import { validateNativeOsDiagnosticBinding } from './native-os-diagnostics-schema.mjs';

/*
 * Milestone 5A-4 measurement arithmetic. Nothing here touches hardware or the
 * filesystem: a native-diagnostic run hands over one JSON record and this module
 * re-derives every registered metric from the raw per-run observations, so a
 * collector can never publish a number the record does not actually contain.
 *
 * The schema is closed on purpose. A helper run that omits a fingerprint
 * member, hides a retry, or ships four timed runs instead of five is rejected
 * rather than defaulted, because the missing half is exactly the half that
 * would make one host observation look like another.
 */

export const M5_NATIVE_HELPER_WORKLOAD_ID = 'm5-native-helper-and-audio';
export const M5_NATIVE_HELPER_FIXTURE_ID = 'm5-helper-fault-and-loopback-v1';
export const M5_NATIVE_HELPER_ENVIRONMENT_ID = 'native-os-diagnostics';
export const M5_NATIVE_HELPER_PROFILE = 'native-helper-fault-and-loopback-v1';
export const M5_NATIVE_HELPER_OBSERVATION_CLASS = 'fresh-helper-fault-and-device-loopback-v1';

/** The exact eight metrics the workload registers; the collector re-checks this against config. */
export const M5_NATIVE_HELPER_METRIC_IDS = Object.freeze([
	'native.unauthorizedCapabilityGrants',
	'native.corruptPublishedRevisions',
	'native.cancellationP95Ms',
	'native.crashDetectionMaximumMs',
	'native.editorRecoveryMaximumMs',
	'native.helperPeakRssBytes',
	'native.audioRoundTripLatencyP95Ms',
	'native.audioUnderrunFrames',
]);

/*
 * A diagnostic may only report a backend its observed operating system ships.
 * Without this check a Windows loopback could be relabelled as a macOS run.
 *
 * The rows are the helper contract's publishable backends split by platform:
 * PipeWire is the primary Linux backend, ALSA the direct `hw:` backup, JACK the
 * backend a user who runs a JACK graph gets. Shared and exclusive are modes of
 * `wasapi`, not backends of their own, and the synthetic proof backend is never
 * device evidence.
 */
export const M5_NATIVE_HELPER_PLATFORM_AUDIO_BACKENDS = Object.freeze({
	windowsX64: Object.freeze(['wasapi', 'asio']),
	windowsArm64: Object.freeze(['wasapi', 'asio']),
	macosArm64: Object.freeze(['coreaudio']),
	linuxX64: Object.freeze(['pipewire', 'alsa', 'jack']),
	linuxArm64: Object.freeze(['pipewire', 'alsa', 'jack']),
});

/** Supported native platform identifiers; one diagnostic describes only one observed host. */
export const M5_NATIVE_HELPER_PLATFORM_IDS = Object.freeze(Object.keys(M5_NATIVE_HELPER_PLATFORM_AUDIO_BACKENDS));

/** A requested backend is evidence only when it is the backend that actually ran. */
export const M5_NATIVE_HELPER_AUDIO_BACKENDS = Object.freeze([
	...new Set(Object.values(M5_NATIVE_HELPER_PLATFORM_AUDIO_BACKENDS).flat()),
]);

/** OS, CPU, memory, interface, driver, backend, buffer, rate, Electron, digests, package. */
export const M5_NATIVE_HELPER_FINGERPRINT_FIELDS = Object.freeze([
	'osImage',
	'osVersion',
	'cpuModel',
	'logicalCpuCount',
	'memoryBytes',
	'audioInterfaceModel',
	'audioDriverVersion',
	'audioBackend',
	'audioBufferFrames',
	'audioSampleRate',
	'electronVersion',
	'helperBinarySha256',
	'nativeAddonSha256',
	'packageIdentity',
	'packageSha256',
]);

const FINGERPRINT_STRING_FIELDS = Object.freeze([
	'osImage', 'osVersion', 'cpuModel', 'audioInterfaceModel', 'audioDriverVersion',
	'electronVersion', 'packageIdentity',
]);
const FINGERPRINT_INTEGER_FIELDS = Object.freeze([
	'logicalCpuCount', 'memoryBytes', 'audioBufferFrames', 'audioSampleRate',
]);
const FINGERPRINT_DIGEST_FIELDS = Object.freeze([
	'helperBinarySha256', 'nativeAddonSha256', 'packageSha256',
]);
const MEASUREMENT_FIELDS_V1 = Object.freeze([
	'environmentId', 'fingerprint', 'fixtureId', 'observationClass', 'platformId',
	'profile', 'runs', 'schemaVersion', 'warmupRuns', 'workloadId',
]);
const MEASUREMENT_FIELDS_V2 = Object.freeze([
	'budgetSha256', 'environmentId', 'fixtureId', 'diagnosticBinding', 'observationClass',
	'observedRuntimeProfile', 'platformId', 'profile', 'runs', 'schemaVersion',
	'sourceRevision', 'warmupRuns', 'workloadId',
]);
const OBSERVED_RUNTIME_PROFILE_FIELDS = Object.freeze([
	'audioBackend', 'audioMode', 'bufferFrames', 'deviceIdentity', 'driverIdentity', 'sampleRate',
]);
const RUN_FIELDS = Object.freeze([
	'attemptCount', 'audioRoundTripSamplesMs', 'audioUnderrunFrames', 'cancellationSamplesMs',
	'capabilityGrants', 'crashDetectionSamplesMs', 'editorRecoverySamplesMs', 'freshHelper',
	'helperPeakRssBytes', 'helperProcessId', 'loopbackDurationSeconds', 'malformedCasesPresented',
	'malformedCasesRejected', 'publishedRevisions', 'retried', 'runIndex',
]);
const GRANT_FIELDS = Object.freeze(['authorized', 'capabilityId']);
const REVISION_FIELDS = Object.freeze(['expectedSha256', 'observedSha256', 'revisionId']);
const EXPECTATION_FIELDS_V1 = Object.freeze(['fixtureSpecification', 'measurementPolicy']);
const EXPECTATION_FIELDS_V2 = Object.freeze([
	'budgetSha256', 'fixtureSpecification', 'diagnosticEnvironment', 'measurementPolicy',
]);
const FIXTURE_FIELDS = Object.freeze(['loopbackDurationSeconds', 'malformedCaseCount']);
const SAMPLE_ARRAY_FIELDS = Object.freeze([
	'cancellationSamplesMs', 'crashDetectionSamplesMs', 'editorRecoverySamplesMs',
	'audioRoundTripSamplesMs',
]);
const MAXIMUM_SAMPLES = 262_144;
const MAXIMUM_LEDGER_ENTRIES = 65_536;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;

/**
 * Re-derive the eight registered metrics from one validated measurement record.
 * Pure: no clock, no device, no config lookup — the caller supplies the frozen
 * fixture specification and measurement policy it read from the budget.
 *
 * @param {unknown} measurement
 * @param {{ fixtureSpecification: unknown, measurementPolicy: unknown }} expectation
 */
export function computeM5NativeHelperMetrics(measurement, expectation) {
	const validated = validateM5NativeHelperMeasurement(measurement, expectation);
	const cancellationSamples = [];
	const crashDetectionSamples = [];
	const editorRecoverySamples = [];
	const roundTripSamples = [];
	let unauthorizedCapabilityGrants = 0;
	let corruptPublishedRevisions = 0;
	let capabilityGrants = 0;
	let publishedRevisions = 0;
	let helperPeakRssBytes = 0;
	let audioUnderrunFrames = 0;
	// The warm-up settles the device and the page cache, so its timings are
	// discarded. Its authorization and publication ledgers are not: a helper that
	// escalated once has escalated, and dropping the warm-up would make that
	// exact failure disappear from a zero-tolerance count.
	for (const run of [...validated.warmupRuns, ...validated.runs]) {
		for (const grant of run.capabilityGrants) {
			capabilityGrants += 1;
			if (grant.authorized !== true) unauthorizedCapabilityGrants += 1;
		}
		for (const revision of run.publishedRevisions) {
			publishedRevisions += 1;
			if (revision.observedSha256 !== revision.expectedSha256) corruptPublishedRevisions += 1;
		}
	}
	for (const run of validated.runs) {
		collect(cancellationSamples, run.cancellationSamplesMs);
		collect(crashDetectionSamples, run.crashDetectionSamplesMs);
		collect(editorRecoverySamples, run.editorRecoverySamplesMs);
		collect(roundTripSamples, run.audioRoundTripSamplesMs);
		helperPeakRssBytes = Math.max(helperPeakRssBytes, run.helperPeakRssBytes);
		audioUnderrunFrames += run.audioUnderrunFrames;
	}
	return Object.freeze({
		schemaVersion: validated.schemaVersion,
		platformId: validated.platformId,
		...(validated.schemaVersion === 1
			? { fingerprint: validated.fingerprint }
			: {
				budgetSha256: validated.budgetSha256,
				diagnosticBinding: validated.diagnosticBinding,
				observedRuntimeProfile: validated.observedRuntimeProfile,
				sourceRevision: validated.sourceRevision,
			}),
		metrics: Object.freeze({
			'native.unauthorizedCapabilityGrants': unauthorizedCapabilityGrants,
			'native.corruptPublishedRevisions': corruptPublishedRevisions,
			'native.cancellationP95Ms': nearestRank(cancellationSamples, 0.95),
			'native.crashDetectionMaximumMs': maximum(crashDetectionSamples),
			'native.editorRecoveryMaximumMs': maximum(editorRecoverySamples),
			'native.helperPeakRssBytes': helperPeakRssBytes,
			'native.audioRoundTripLatencyP95Ms': nearestRank(roundTripSamples, 0.95),
			'native.audioUnderrunFrames': audioUnderrunFrames,
		}),
		rawSampleCounts: Object.freeze({
			warmupRuns: validated.warmupRuns.length,
			timedRuns: validated.runs.length,
			capabilityGrants,
			publishedRevisions,
			cancellationSamples: cancellationSamples.length,
			crashDetectionSamples: crashDetectionSamples.length,
			editorRecoverySamples: editorRecoverySamples.length,
			audioRoundTripSamples: roundTripSamples.length,
			malformedCasesPerRun: validated.runs[0].malformedCasesPresented,
			loopbackSecondsPerRun: validated.runs[0].loopbackDurationSeconds,
		}),
	});
}

/**
 * Admit one complete no-retry record: exact fields everywhere, a fingerprint
 * with every required member, one warm-up helper, and exactly the configured
 * number of fresh timed helpers.
 */
export function validateM5NativeHelperMeasurement(measurementValue, expectationValue) {
	const measurementSnapshot = snapshotStrictJsonData(measurementValue, 'M5 measurement');
	const measurementRecord = requireRecord(measurementSnapshot, 'M5 measurement');
	const schemaVersion = measurementRecord.schemaVersion;
	if (schemaVersion !== 1 && schemaVersion !== 2) {
		throw new Error('M5 measurement schemaVersion must be 1 or 2.');
	}
	const expectation = exactRecord(
		snapshotStrictJsonData(expectationValue, 'M5 expectation'),
		schemaVersion === 1 ? EXPECTATION_FIELDS_V1 : EXPECTATION_FIELDS_V2,
		'M5 expectation',
	);
	const policy = assertMeasurementPolicy(expectation.measurementPolicy);
	const fixture = assertFixtureSpecification(expectation.fixtureSpecification);
	const measurement = exactRecord(
		measurementSnapshot,
		schemaVersion === 1 ? MEASUREMENT_FIELDS_V1 : MEASUREMENT_FIELDS_V2,
		'M5 measurement',
	);
	if (measurement.profile !== M5_NATIVE_HELPER_PROFILE
		|| measurement.observationClass !== M5_NATIVE_HELPER_OBSERVATION_CLASS
		|| measurement.workloadId !== M5_NATIVE_HELPER_WORKLOAD_ID
		|| measurement.fixtureId !== M5_NATIVE_HELPER_FIXTURE_ID
		|| measurement.environmentId !== M5_NATIVE_HELPER_ENVIRONMENT_ID) {
		throw new Error('M5 measurement identity does not match the frozen native workload.');
	}
	if (!M5_NATIVE_HELPER_PLATFORM_IDS.includes(measurement.platformId)) {
		throw new Error(`M5 measurement platformId must be one of ${M5_NATIVE_HELPER_PLATFORM_IDS.join(', ')}.`);
	}
	const environmentObservation = schemaVersion === 1
		? { fingerprint: validateFingerprint(measurement.fingerprint, measurement.platformId) }
		: validateV2DiagnosticBinding(measurement, expectation.diagnosticEnvironment, expectation.budgetSha256);
	const warmupRuns = exactArray(
		measurement.warmupRuns,
		policy.timingWarmupTrials,
		`M5 measurement.warmupRuns must contain exactly ${policy.timingWarmupTrials} warm-up run`,
	);
	const runs = exactArray(
		measurement.runs,
		policy.timingTrials,
		`M5 measurement.runs must contain exactly ${policy.timingTrials} fresh-helper runs`,
	);
	const helperProcessIds = new Set();
	const validatedWarmup = warmupRuns.map((run, index) =>
		validateRun(run, index, fixture, `M5 measurement.warmupRuns[${index}]`, helperProcessIds));
	const validatedRuns = runs.map((run, index) =>
		validateRun(run, index, fixture, `M5 measurement.runs[${index}]`, helperProcessIds));
	return deepFreeze({
		...measurement,
		...environmentObservation,
		warmupRuns: validatedWarmup,
		runs: validatedRuns,
	});
}

function validateV2DiagnosticBinding(measurement, diagnosticEnvironment, budgetSha256) {
	const binding = validateNativeOsDiagnosticBinding(
		measurement.diagnosticBinding,
		diagnosticEnvironment,
	);
	if (binding.platformId !== measurement.platformId) {
		throw new Error('M5 measurement platformId does not match its diagnostic binding.');
	}
	if (typeof measurement.budgetSha256 !== 'string'
		|| !SHA256_PATTERN.test(measurement.budgetSha256)
		|| measurement.budgetSha256 !== budgetSha256) {
		throw new Error('M5 measurement budget digest does not match its exact quality budget.');
	}
	if (typeof measurement.sourceRevision !== 'string'
		|| !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(measurement.sourceRevision)
		|| measurement.sourceRevision !== binding.artifacts.sourceRevision) {
		throw new Error('M5 measurement source revision does not match its artifact binding.');
	}
	const observed = exactRecord(
		measurement.observedRuntimeProfile,
		OBSERVED_RUNTIME_PROFILE_FIELDS,
		'M5 measurement.observedRuntimeProfile',
	);
	for (const field of ['audioBackend', 'audioMode', 'deviceIdentity', 'driverIdentity']) {
		boundedString(observed[field], 1, 1_024, `M5 measurement.observedRuntimeProfile.${field}`);
	}
	positiveInteger(observed.sampleRate, 'M5 measurement.observedRuntimeProfile.sampleRate');
	positiveInteger(observed.bufferFrames, 'M5 measurement.observedRuntimeProfile.bufferFrames');
	if (!M5_NATIVE_HELPER_PLATFORM_AUDIO_BACKENDS[binding.platformId].includes(observed.audioBackend)
		|| observed.deviceIdentity !== binding.observedHost.audioInterfaceModel
		|| observed.driverIdentity !== binding.observedHost.audioDriverVersion) {
		throw new Error('M5 measurement observed runtime profile does not match its diagnostic host.');
	}
	for (const field of ['helperBinarySha256', 'nativeAddonSha256']) {
		if (!SHA256_PATTERN.test(String(binding.artifacts[field]))) {
			throw new Error(`M5 measurement diagnostic binding requires ${field}.`);
		}
	}
	return {
		budgetSha256: measurement.budgetSha256,
		diagnosticBinding: binding,
		observedRuntimeProfile: Object.freeze(observed),
		sourceRevision: measurement.sourceRevision,
	};
}

function validateRun(value, index, fixture, path, helperProcessIds) {
	const run = exactRecord(value, RUN_FIELDS, path);
	if (run.runIndex !== index) throw new Error(`${path}.runIndex must be ${index}.`);
	// Retry-to-pass is the failure mode this whole procedure exists to exclude,
	// so a retried or reused helper is refused before any number is believed.
	if (run.retried !== false) {
		throw new Error(`${path} was retried; the M5 timing procedure forbids retry-to-pass.`);
	}
	if (run.attemptCount !== 1) throw new Error(`${path}.attemptCount must be exactly 1.`);
	if (run.freshHelper !== true) {
		throw new Error(`${path}.freshHelper must be true; every timed run needs its own helper.`);
	}
	const helperProcessId = boundedString(run.helperProcessId, 1, 256, `${path}.helperProcessId`);
	if (helperProcessIds.has(helperProcessId)) {
		throw new Error(`${path}.helperProcessId ${helperProcessId} was reused by another run.`);
	}
	helperProcessIds.add(helperProcessId);
	if (run.malformedCasesPresented !== fixture.malformedCaseCount
		|| run.malformedCasesRejected !== fixture.malformedCaseCount) {
		throw new Error(`${path} must present and reject exactly ${fixture.malformedCaseCount} malformed cases.`);
	}
	if (run.loopbackDurationSeconds !== fixture.loopbackDurationSeconds) {
		throw new Error(`${path}.loopbackDurationSeconds must be ${fixture.loopbackDurationSeconds}.`);
	}
	positiveInteger(run.helperPeakRssBytes, `${path}.helperPeakRssBytes`);
	nonNegativeInteger(run.audioUnderrunFrames, `${path}.audioUnderrunFrames`);
	const samples = {};
	for (const field of SAMPLE_ARRAY_FIELDS) {
		samples[field] = Object.freeze(sampleArray(run[field], `${path}.${field}`));
	}
	return Object.freeze({
		...run,
		...samples,
		capabilityGrants: validateCapabilityGrants(run.capabilityGrants, path),
		publishedRevisions: validatePublishedRevisions(run.publishedRevisions, path),
	});
}

function validateCapabilityGrants(value, path) {
	const grants = boundedArray(value, 1, MAXIMUM_LEDGER_ENTRIES, `${path}.capabilityGrants`);
	const ids = new Set();
	return Object.freeze(grants.map((entry, index) => {
		const grantPath = `${path}.capabilityGrants[${index}]`;
		const grant = exactRecord(entry, GRANT_FIELDS, grantPath);
		const capabilityId = boundedString(grant.capabilityId, 1, 160, `${grantPath}.capabilityId`);
		if (typeof grant.authorized !== 'boolean') {
			throw new Error(`${grantPath}.authorized must be a boolean.`);
		}
		if (ids.has(capabilityId)) throw new Error(`${grantPath} repeats capability ${capabilityId}.`);
		ids.add(capabilityId);
		return Object.freeze(grant);
	}));
}

function validatePublishedRevisions(value, path) {
	const revisions = boundedArray(value, 1, MAXIMUM_LEDGER_ENTRIES, `${path}.publishedRevisions`);
	const ids = new Set();
	return Object.freeze(revisions.map((entry, index) => {
		const revisionPath = `${path}.publishedRevisions[${index}]`;
		const revision = exactRecord(entry, REVISION_FIELDS, revisionPath);
		const revisionId = boundedString(revision.revisionId, 1, 160, `${revisionPath}.revisionId`);
		for (const field of ['expectedSha256', 'observedSha256']) {
			if (typeof revision[field] !== 'string' || !SHA256_PATTERN.test(revision[field])) {
				throw new Error(`${revisionPath}.${field} must be one lowercase SHA-256.`);
			}
		}
		if (ids.has(revisionId)) throw new Error(`${revisionPath} repeats revision ${revisionId}.`);
		ids.add(revisionId);
		return Object.freeze(revision);
	}));
}

function validateFingerprint(value, platformId) {
	const fingerprint = requireRecord(value, 'M5 measurement.fingerprint');
	const known = new Set(M5_NATIVE_HELPER_FINGERPRINT_FIELDS);
	const missing = M5_NATIVE_HELPER_FINGERPRINT_FIELDS.filter((field) =>
		!Object.hasOwn(fingerprint, field));
	const unexpected = Object.keys(fingerprint).filter((field) => !known.has(field));
	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(`M5 fingerprint is incomplete: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}].`);
	}
	for (const field of FINGERPRINT_STRING_FIELDS) {
		boundedString(fingerprint[field], 1, 4_096, `M5 fingerprint ${field}`);
	}
	for (const field of FINGERPRINT_INTEGER_FIELDS) {
		positiveInteger(fingerprint[field], `M5 fingerprint ${field}`);
	}
	for (const field of FINGERPRINT_DIGEST_FIELDS) {
		if (typeof fingerprint[field] !== 'string' || !SHA256_PATTERN.test(fingerprint[field])) {
			throw new Error(`M5 fingerprint ${field} must be one lowercase SHA-256.`);
		}
	}
	if (!M5_NATIVE_HELPER_AUDIO_BACKENDS.includes(fingerprint.audioBackend)) {
		throw new Error(`M5 fingerprint audioBackend must be one of ${M5_NATIVE_HELPER_AUDIO_BACKENDS.join(', ')}.`);
	}
	if (!M5_NATIVE_HELPER_PLATFORM_AUDIO_BACKENDS[platformId].includes(fingerprint.audioBackend)) {
		throw new Error(`M5 fingerprint audioBackend ${fingerprint.audioBackend} is not a backend ${platformId} runs.`);
	}
	return Object.freeze(fingerprint);
}

function assertMeasurementPolicy(value) {
	const policy = requireRecord(value, 'M5 measurementPolicy');
	if (policy.percentileMethod !== 'nearest-rank'
		|| policy.benchmarkRetries !== 0
		|| policy.timingWorkers !== 1
		|| policy.timingWarmupTrials !== 1
		|| policy.timingTrials !== 5) {
		throw new Error('M5 timing requires the frozen one-warm-up, five-run, no-retry policy.');
	}
	return policy;
}

function assertFixtureSpecification(value) {
	const fixture = exactRecord(value, FIXTURE_FIELDS, 'M5 fixtureSpecification');
	positiveInteger(fixture.malformedCaseCount, 'M5 fixtureSpecification.malformedCaseCount');
	positiveInteger(fixture.loopbackDurationSeconds, 'M5 fixtureSpecification.loopbackDurationSeconds');
	return Object.freeze(fixture);
}

function collect(target, values) {
	for (const value of values) target.push(value);
}

function maximum(values) {
	if (values.length === 0) throw new Error('A maximum requires samples.');
	return values.reduce((left, right) => Math.max(left, right), 0);
}

function nearestRank(values, percentile) {
	if (values.length === 0) throw new Error('Nearest-rank percentile requires samples.');
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function sampleArray(value, path) {
	const samples = boundedArray(value, 1, MAXIMUM_SAMPLES, path);
	return samples.map((sample, index) => {
		if (!Number.isFinite(sample) || sample < 0) {
			throw new Error(`${path}[${index}] must be a finite non-negative measurement.`);
		}
		return sample;
	});
}

function boundedArray(value, minimum, maximum, path) {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must contain ${minimum} through ${maximum} entries.`);
	}
	return value;
}

function exactArray(value, length, message) {
	if (!Array.isArray(value) || value.length !== length) throw new Error(`${message}.`);
	return value;
}
