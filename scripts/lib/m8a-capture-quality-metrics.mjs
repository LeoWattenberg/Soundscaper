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

export const M8A_CAPTURE_WORKLOAD_ID = 'm8a-capture-long-session';
export const M8A_CAPTURE_FIXTURE_ID = 'm8a-capture-30m-all-sources-v1';
export const M8A_CAPTURE_ENVIRONMENT_ID = 'capture-os-browser-lab-matrix';
export const M8A_CAPTURE_PROFILE = 'framescaper-capture-30m-six-combination-v1';
export const M8A_CAPTURE_OBSERVATION_CLASS = 'real-device-shared-clock-durability-v1';

export const M8A_CAPTURE_COMBINATIONS = deepFreeze([
	{ id: 'camera-only', requestedRoles: ['camera'] },
	{ id: 'microphone-only', requestedRoles: ['microphone'] },
	{ id: 'display-only', requestedRoles: ['display'] },
	{ id: 'camera-plus-microphone', requestedRoles: ['camera', 'microphone'] },
	{ id: 'display-plus-microphone', requestedRoles: ['display', 'microphone'] },
	{ id: 'camera-plus-display-plus-microphone', requestedRoles: ['camera', 'display', 'microphone'] },
]);

export const M8A_CAPTURE_METRIC_IDS = Object.freeze([
	'capture.sourceCombinationsCompleted',
	'capture.avDriftMaximumMs',
	'capture.droppedFrameRatio',
	'capture.unreportedDroppedFrames',
	'capture.audioDropoutFrames',
	'capture.deviceTeardownP95Ms',
	'capture.unrecoverableDurableFragments',
	'capture.unauthorizedDeviceOpens',
]);

export const M8A_CAPTURE_FINGERPRINT_FIELDS = Object.freeze([
	'camera', 'microphone', 'displayCapture', 'systemAudio',
]);

const CAPTURE_ROLES = Object.freeze(['camera', 'microphone', 'display', 'system-audio']);
const MEASUREMENT_FIELDS = Object.freeze([
	'combinations', 'environmentId', 'fingerprint', 'fixtureId', 'observationClass',
	'profile', 'schemaVersion', 'workloadId',
]);
const COMBINATION_FIELDS = Object.freeze([
	'attemptCount', 'combinationId', 'completed', 'deviceOpens', 'durableFragments',
	'observedDurationSeconds', 'requestedRoles', 'retried', 'returnedRoles', 'streams',
	'syncPairs', 'teardownSamplesMs',
]);
const VIDEO_STREAM_FIELDS = Object.freeze([
	'expectedFrames', 'kind', 'nominalFrameRate', 'receivedFrames',
	'reportedDroppedFrames', 'role',
]);
const AUDIO_STREAM_FIELDS = Object.freeze([
	'expectedFrames', 'kind', 'receivedFrames', 'role', 'sampleRate',
]);
const SYNC_PAIR_FIELDS = Object.freeze(['audioRole', 'samples', 'videoRole']);
const SYNC_SAMPLE_FIELDS = Object.freeze(['audioPtsUs', 'elapsedSecond', 'videoPtsUs']);
const FRAGMENT_FIELDS = Object.freeze(['fragmentId', 'recoverable', 'role']);
const DEVICE_OPEN_FIELDS = Object.freeze(['directUserAuthorization', 'opened', 'role']);
const EXPECTATION_FIELDS = Object.freeze(['fixtureSpecification']);
const FIXTURE_FIELDS = Object.freeze(['durationSeconds', 'sourceCombinationCount']);
const MAXIMUM_LEDGER_ENTRIES = 1_000_000;

/** Recompute all eight registered capture metrics from one closed lab record. */
export function computeM8ACaptureMetrics(measurement, expectation) {
	const validated = validateM8ACaptureMeasurement(measurement, expectation);
	let combinationsCompleted = 0;
	let captureSeconds = 0;
	let videoFramesExpected = 0;
	let videoFramesReceived = 0;
	let audioFramesExpected = 0;
	let audioFramesReceived = 0;
	let unreportedDroppedFrames = 0;
	let unrecoverableDurableFragments = 0;
	let unauthorizedDeviceOpens = 0;
	const driftSamplesMs = [];
	const teardownSamplesMs = [];
	let syncSampleCount = 0;
	let durableFragmentCount = 0;
	let deviceOpenCount = 0;

	for (const combination of validated.combinations) {
		if (combination.completed) combinationsCompleted += 1;
		captureSeconds += combination.observedDurationSeconds;
		for (const stream of combination.streams) {
			if (stream.kind === 'video') {
				videoFramesExpected += stream.expectedFrames;
				videoFramesReceived += stream.receivedFrames;
				unreportedDroppedFrames += stream.expectedFrames
					- stream.receivedFrames
					- stream.reportedDroppedFrames;
			} else {
				audioFramesExpected += stream.expectedFrames;
				audioFramesReceived += stream.receivedFrames;
			}
		}
		for (const pair of combination.syncPairs) {
			for (const sample of pair.samples) {
				driftSamplesMs.push(Math.abs(sample.audioPtsUs - sample.videoPtsUs) / 1_000);
				syncSampleCount += 1;
			}
		}
		teardownSamplesMs.push(...combination.teardownSamplesMs);
		for (const fragment of combination.durableFragments) {
			durableFragmentCount += 1;
			if (!fragment.recoverable) unrecoverableDurableFragments += 1;
		}
		for (const open of combination.deviceOpens) {
			deviceOpenCount += 1;
			if (open.opened && !open.directUserAuthorization) unauthorizedDeviceOpens += 1;
		}
	}

	const droppedFrames = videoFramesExpected - videoFramesReceived;
	return Object.freeze({
		fingerprint: validated.fingerprint,
		metrics: Object.freeze({
			'capture.sourceCombinationsCompleted': combinationsCompleted,
			'capture.avDriftMaximumMs': maximum(driftSamplesMs),
			'capture.droppedFrameRatio': videoFramesExpected === 0
				? 1
				: droppedFrames / videoFramesExpected,
			'capture.unreportedDroppedFrames': unreportedDroppedFrames,
			'capture.audioDropoutFrames': audioFramesExpected - audioFramesReceived,
			'capture.deviceTeardownP95Ms': nearestRank(teardownSamplesMs, 0.95),
			'capture.unrecoverableDurableFragments': unrecoverableDurableFragments,
			'capture.unauthorizedDeviceOpens': unauthorizedDeviceOpens,
		}),
		rawSampleCounts: Object.freeze({
			combinations: validated.combinations.length,
			captureSeconds,
			videoFramesExpected,
			videoFramesReceived,
			audioFramesExpected,
			audioFramesReceived,
			syncSamples: syncSampleCount,
			teardownSamples: teardownSamplesMs.length,
			durableFragments: durableFragmentCount,
			deviceOpens: deviceOpenCount,
		}),
	});
}

/** Admit one complete, no-retry, six-row, real-device measurement record. */
export function validateM8ACaptureMeasurement(measurementValue, expectationValue) {
	const expectation = exactRecord(
		snapshotStrictJsonData(expectationValue, 'M8A expectation'),
		EXPECTATION_FIELDS,
		'M8A expectation',
	);
	const fixture = validateFixture(expectation.fixtureSpecification);
	const measurement = exactRecord(
		snapshotStrictJsonData(measurementValue, 'M8A measurement'),
		MEASUREMENT_FIELDS,
		'M8A measurement',
	);
	assertMeasurementIdentity(measurement);
	const fingerprint = validateFingerprint(measurement.fingerprint);
	const rows = exactArray(
		measurement.combinations,
		fixture.sourceCombinationCount,
		`M8A measurement.combinations must contain exactly ${fixture.sourceCombinationCount} source combinations`,
	);
	const fragmentIds = new Set();
	const combinations = rows.map((row, index) => validateCombination(
		row,
		M8A_CAPTURE_COMBINATIONS[index],
		fixture.durationSeconds,
		index,
		fragmentIds,
	));
	return deepFreeze({ ...measurement, fingerprint, combinations });
}

function validateFixture(value) {
	const fixture = exactRecord(value, FIXTURE_FIELDS, 'M8A fixtureSpecification');
	positiveInteger(fixture.durationSeconds, 'M8A fixtureSpecification.durationSeconds');
	positiveInteger(fixture.sourceCombinationCount, 'M8A fixtureSpecification.sourceCombinationCount');
	if (fixture.durationSeconds !== 1_800 || fixture.sourceCombinationCount !== M8A_CAPTURE_COMBINATIONS.length) {
		throw new Error('M8A fixture must retain the frozen 30-minute, six-combination specification.');
	}
	return fixture;
}

function assertMeasurementIdentity(measurement) {
	if (measurement.schemaVersion !== 1
		|| measurement.profile !== M8A_CAPTURE_PROFILE
		|| measurement.observationClass !== M8A_CAPTURE_OBSERVATION_CLASS
		|| measurement.workloadId !== M8A_CAPTURE_WORKLOAD_ID
		|| measurement.fixtureId !== M8A_CAPTURE_FIXTURE_ID
		|| measurement.environmentId !== M8A_CAPTURE_ENVIRONMENT_ID) {
		throw new Error('M8A measurement identity does not match the frozen capture workload.');
	}
}

function validateFingerprint(value) {
	const fingerprint = exactRecord(
		value,
		M8A_CAPTURE_FINGERPRINT_FIELDS,
		'M8A measurement fingerprint',
	);
	for (const field of M8A_CAPTURE_FINGERPRINT_FIELDS) {
		const entry = requireRecord(fingerprint[field], `M8A fingerprint ${field}`);
		if (Object.keys(entry).length === 0) {
			throw new Error(`M8A fingerprint ${field} must record a non-empty device observation.`);
		}
	}
	return Object.freeze(fingerprint);
}

function validateCombination(value, definition, durationSeconds, index, fragmentIds) {
	const path = `M8A measurement.combinations[${index}]`;
	const row = exactRecord(value, COMBINATION_FIELDS, path);
	if (row.combinationId !== definition.id || !sameStrings(row.requestedRoles, definition.requestedRoles)) {
		throw new Error(`${path} does not match the frozen source combination ${definition.id}.`);
	}
	if (row.attemptCount !== 1 || row.retried !== false) {
		throw new Error(`${path} must be one no-retry attempt.`);
	}
	nonNegativeInteger(row.observedDurationSeconds, `${path}.observedDurationSeconds`);
	if (row.observedDurationSeconds > durationSeconds) {
		throw new Error(`${path}.observedDurationSeconds must be between 0 and ${durationSeconds}.`);
	}
	if (typeof row.completed !== 'boolean'
		|| row.completed !== (row.observedDurationSeconds === durationSeconds)) {
		throw new Error(`${path}.completed must exactly report whether the 30-minute duration finished.`);
	}
	const returnedRoles = validateReturnedRoles(row.returnedRoles, definition.requestedRoles, path);
	const streams = validateStreams(row.streams, returnedRoles, row.observedDurationSeconds, path);
	const syncPairs = validateSyncPairs(
		row.syncPairs, returnedRoles, row.observedDurationSeconds, path,
	);
	const teardownSamplesMs = sampleArray(row.teardownSamplesMs, `${path}.teardownSamplesMs`);
	const durableFragments = validateFragments(
		row.durableFragments, returnedRoles, path, fragmentIds,
	);
	const deviceOpens = validateDeviceOpens(row.deviceOpens, definition.requestedRoles, path);
	return Object.freeze({
		...row, returnedRoles, streams, syncPairs, teardownSamplesMs, durableFragments, deviceOpens,
	});
}

function validateReturnedRoles(value, requestedRoles, path) {
	if (!Array.isArray(value) || value.length < requestedRoles.length || value.length > CAPTURE_ROLES.length) {
		throw new Error(`${path}.returnedRoles must contain every requested role and at most optional system-audio.`);
	}
	const roles = value.map((role, index) => captureRole(role, `${path}.returnedRoles[${index}]`));
	if (new Set(roles).size !== roles.length) throw new Error(`${path}.returnedRoles must not repeat a role.`);
	const expected = [...requestedRoles];
	if (roles.length === requestedRoles.length + 1) expected.push('system-audio');
	if (!sameStrings(roles, expected)) {
		throw new Error(`${path}.returnedRoles must contain requested roles plus only optional system-audio.`);
	}
	if (roles.includes('system-audio') && !roles.includes('display')) {
		throw new Error(`${path} system-audio requires display in the same returned source set.`);
	}
	return Object.freeze(roles);
}

function validateStreams(value, roles, durationSeconds, path) {
	const streams = exactArray(value, roles.length, `${path}.streams must contain one stream per returned role`);
	return Object.freeze(streams.map((value, index) => {
		const role = roles[index];
		const streamPath = `${path}.streams[${index}]`;
		if (role === 'camera' || role === 'display') {
			const stream = exactRecord(value, VIDEO_STREAM_FIELDS, streamPath);
			if (stream.role !== role || stream.kind !== 'video') {
				throw new Error(`${streamPath} must describe the returned ${role} video stream.`);
			}
			positiveInteger(stream.nominalFrameRate, `${streamPath}.nominalFrameRate`);
			validateFrameCounts(stream, durationSeconds * stream.nominalFrameRate, streamPath);
			nonNegativeInteger(stream.reportedDroppedFrames, `${streamPath}.reportedDroppedFrames`);
			const absent = stream.expectedFrames - stream.receivedFrames;
			if (stream.reportedDroppedFrames > absent) {
				throw new Error(`${streamPath} cannot report more dropped frames than were absent.`);
			}
			return Object.freeze(stream);
		}
		const stream = exactRecord(value, AUDIO_STREAM_FIELDS, streamPath);
		if (stream.role !== role || stream.kind !== 'audio') {
			throw new Error(`${streamPath} must describe the returned ${role} audio stream.`);
		}
		positiveInteger(stream.sampleRate, `${streamPath}.sampleRate`);
		validateFrameCounts(stream, durationSeconds * stream.sampleRate, streamPath);
		return Object.freeze(stream);
	}));
}

function validateFrameCounts(stream, expected, path) {
	nonNegativeInteger(stream.expectedFrames, `${path}.expectedFrames`);
	nonNegativeInteger(stream.receivedFrames, `${path}.receivedFrames`);
	if (stream.expectedFrames !== expected) {
		throw new Error(`${path}.expectedFrames must derive from observed duration and rate.`);
	}
	if (stream.receivedFrames > stream.expectedFrames) {
		throw new Error(`${path}.receivedFrames cannot exceed expectedFrames.`);
	}
}

function validateSyncPairs(value, roles, durationSeconds, path) {
	const audioRoles = roles.filter((role) => role === 'microphone' || role === 'system-audio');
	const videoRoles = roles.filter((role) => role === 'camera' || role === 'display');
	const inventory = videoRoles.flatMap((videoRole) => audioRoles.map((audioRole) => ({
		audioRole, videoRole,
	})));
	const pairs = exactArray(
		value,
		inventory.length,
		`${path}.syncPairs must contain the exact audio/video pair inventory`,
	);
	return Object.freeze(pairs.map((value, index) => {
		const pairPath = `${path}.syncPairs[${index}]`;
		const pair = exactRecord(value, SYNC_PAIR_FIELDS, pairPath);
		const expected = inventory[index];
		if (pair.audioRole !== expected.audioRole || pair.videoRole !== expected.videoRole) {
			throw new Error(`${pairPath} does not match its exact returned-stream pair.`);
		}
		return Object.freeze({
			...pair,
			samples: validateSyncSamples(pair.samples, durationSeconds, pairPath),
		});
	}));
}

function validateSyncSamples(value, durationSeconds, path) {
	const samples = exactArray(
		value,
		durationSeconds + 1,
		`${path}.samples must contain one shared-clock observation per second including both endpoints`,
	);
	let previousAudio = -1;
	let previousVideo = -1;
	return Object.freeze(samples.map((value, index) => {
		const samplePath = `${path}.samples[${index}]`;
		const sample = exactRecord(value, SYNC_SAMPLE_FIELDS, samplePath);
		if (sample.elapsedSecond !== index) throw new Error(`${samplePath}.elapsedSecond must be ${index}.`);
		nonNegativeInteger(sample.audioPtsUs, `${samplePath}.audioPtsUs`);
		nonNegativeInteger(sample.videoPtsUs, `${samplePath}.videoPtsUs`);
		if (index > 0 && (sample.audioPtsUs <= previousAudio || sample.videoPtsUs <= previousVideo)) {
			throw new Error(`${samplePath} media clocks must increase strictly.`);
		}
		previousAudio = sample.audioPtsUs;
		previousVideo = sample.videoPtsUs;
		return Object.freeze(sample);
	}));
}

function validateFragments(value, roles, path, fragmentIds) {
	const fragments = boundedArray(value, roles.length, MAXIMUM_LEDGER_ENTRIES, `${path}.durableFragments`);
	const coveredRoles = new Set();
	const result = fragments.map((value, index) => {
		const fragmentPath = `${path}.durableFragments[${index}]`;
		const fragment = exactRecord(value, FRAGMENT_FIELDS, fragmentPath);
		const fragmentId = boundedString(fragment.fragmentId, 1, 256, `${fragmentPath}.fragmentId`);
		const role = captureRole(fragment.role, `${fragmentPath}.role`);
		if (!roles.includes(role)) throw new Error(`${fragmentPath}.role is not a returned stream.`);
		if (typeof fragment.recoverable !== 'boolean') {
			throw new Error(`${fragmentPath}.recoverable must be a boolean.`);
		}
		if (fragmentIds.has(fragmentId)) throw new Error(`${fragmentPath}.fragmentId is duplicated.`);
		fragmentIds.add(fragmentId);
		coveredRoles.add(role);
		return Object.freeze(fragment);
	});
	if (roles.some((role) => !coveredRoles.has(role))) {
		throw new Error(`${path}.durableFragments must cover every returned stream.`);
	}
	return Object.freeze(result);
}

function validateDeviceOpens(value, requestedRoles, path) {
	const opens = exactArray(
		value,
		requestedRoles.length,
		`${path}.deviceOpens must contain one request ledger entry per requested role`,
	);
	return Object.freeze(opens.map((value, index) => {
		const openPath = `${path}.deviceOpens[${index}]`;
		const open = exactRecord(value, DEVICE_OPEN_FIELDS, openPath);
		if (open.role !== requestedRoles[index]) {
			throw new Error(`${openPath}.role does not match the requested source role.`);
		}
		if (open.opened !== true || typeof open.directUserAuthorization !== 'boolean') {
			throw new Error(`${openPath} must record an opened source and its direct-user authorization verdict.`);
		}
		return Object.freeze(open);
	}));
}

function captureRole(value, path) {
	if (!CAPTURE_ROLES.includes(value)) throw new Error(`${path} must be a known capture role.`);
	return value;
}

function sampleArray(value, path) {
	const samples = exactArray(value, 1, `${path} must contain exactly one whole-session teardown sample`);
	return Object.freeze(samples.map((sample, index) => {
		if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0) {
			throw new Error(`${path}[${index}] must be a finite non-negative sample.`);
		}
		return sample;
	}));
}

function boundedArray(value, minimum, maximum, path) {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must contain between ${minimum} and ${maximum} entries.`);
	}
	return value;
}

function exactArray(value, length, message) {
	if (!Array.isArray(value) || value.length !== length) throw new Error(`${message}.`);
	return value;
}

function sameStrings(left, right) {
	return Array.isArray(left)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}

function maximum(values) {
	if (values.length === 0) throw new Error('M8A capture measurement has no A/V drift samples.');
	return Math.max(...values);
}

function nearestRank(values, percentile) {
	if (values.length === 0) throw new Error('M8A capture measurement has no teardown samples.');
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}
