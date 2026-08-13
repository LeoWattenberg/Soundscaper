/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const M4_PARITY_REFERENCE_ENVIRONMENT_ID = 'reference-linux-gpu-01';
export const M4_PARITY_HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.61.1';
export const M4_PARITY_LOCAL_ENVIRONMENT_ID = 'local-browser-correctness';
export const M4_PARITY_WORKLOAD_ID = 'm4-production-render-parity';

export const M4_PARITY_REFERENCE_FINGERPRINT_FIELDS = Object.freeze([
	'osImage',
	'osUpdatePolicy',
	'cpuModel',
	'logicalCpuCount',
	'memoryBytes',
	'gpuModel',
	'gpuMemoryBytes',
	'gpuDriver',
	'webglVendor',
	'webglRenderer',
	'displayMode',
	'displayRefreshHz',
	'devicePixelRatio',
	'powerProfile',
	'browserVersion',
	'browserBinarySha256',
	'browserLaunchFlags',
	'runnerLabels',
]);
const BROWSER_OBSERVATION_FIELDS = Object.freeze([
	'osImage',
	'cpuModel',
	'logicalCpuCount',
	'memoryBytes',
	'webglVendor',
	'webglRenderer',
	'devicePixelRatio',
	'browserVersion',
	'browserBinarySha256',
]);
const HOST_OBSERVATION_CLASS = 'm4-reference-host-observation-v1';

/** Resolve correctness versus explicitly provisioned reference collection identity. */
export function resolveM4ParityCollectionEnvironment(options, config, processEnvironment = {}) {
	const record = requireRecord(
		snapshotStrictJsonData(options, 'collector options'),
		'collector options',
	);
	const qualityConfig = requireRecord(
		snapshotStrictJsonData(config, 'config'),
		'config',
	);
	const qualificationMode = record.qualificationMode ?? 'correctness';
	if (qualificationMode === 'correctness') {
		return Object.freeze({
			qualificationMode,
			environmentId: ownEnvironmentString(processEnvironment, 'GITHUB_ACTIONS') === 'true'
				? M4_PARITY_HOSTED_ENVIRONMENT_ID
				: M4_PARITY_LOCAL_ENVIRONMENT_ID,
			expectedFingerprint: null,
		});
	}
	if (qualificationMode !== 'reference') {
		throw new Error('M4 collection qualificationMode must be correctness or reference.');
	}
	const environment = exactDescriptor(
		qualityConfig.environments,
		M4_PARITY_REFERENCE_ENVIRONMENT_ID,
		'environment',
	);
	if (!isProvisionedReferenceEnvironment(environment)) {
		throw new Error('Reference collection requires an active eligible provisioned descriptor.');
	}
	return Object.freeze({
		qualificationMode,
		environmentId: M4_PARITY_REFERENCE_ENVIRONMENT_ID,
		expectedFingerprint: Object.freeze(snapshotStrictJsonData(
			environment.fingerprint,
			'reference environment fingerprint',
		)),
	});
}

/** Parse an explicit mode without letting default correctness claim reference identity. */
export function parseM4ParityCliOptions(args, environment = {}) {
	const values = snapshotStrictJsonData(args, 'M4 collector CLI arguments');
	if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
		throw new TypeError('M4 collector CLI arguments must be strings.');
	}
	let qualificationMode = ownEnvironmentString(
		environment,
		'SOUNDSCAPER_M4_REFERENCE_QUALIFICATION',
	) === '1'
		? 'reference'
		: 'correctness';
	let outputDirectory = null;
	for (const argument of values) {
		if (argument === '--reference') {
			if (qualificationMode === 'reference') {
				throw new Error('Reference qualification mode may be selected only once.');
			}
			qualificationMode = 'reference';
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown M4 collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M4 collector accepts one output directory.');
		outputDirectory = argument;
	}
	return Object.freeze({ qualificationMode, outputDirectory });
}

/** Require the browser to report its observed collection identity, never a configured echo. */
export function assertM4ParityCollectionEnvironment(diagnostic, collectionEnvironment) {
	const observed = snapshotStrictJsonData(diagnostic, 'browser diagnostic');
	const expected = snapshotStrictJsonData(collectionEnvironment, 'collection environment');
	if (observed.environmentId !== expected.environmentId) {
		throw new Error('Browser diagnostic relabeled its collection environment.');
	}
	if (expected.qualificationMode === 'reference'
		&& !deepEqualJson(
			observed.environmentFingerprint,
			expected.expectedFingerprint,
		)) {
		throw new Error('Browser-observed reference fingerprint does not match the provisioned descriptor.');
	}
}

/** Read a provisioning-owned observation without consulting the expected descriptor. */
export async function readM4ParityReferenceHostObservation(path) {
	if (typeof path !== 'string' || path.length < 1 || path.length > 4_096) {
		throw new Error('Reference qualification requires a host observation JSON path.');
	}
	let parsed;
	try {
		parsed = JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`Reference host observation is unavailable or invalid: ${errorMessage(error)}.`);
	}
	const envelope = requireExactRecord(
		snapshotStrictJsonData(parsed, 'reference host observation'),
		['fingerprint', 'observationClass', 'schemaVersion'],
		'reference host observation',
	);
	if (envelope.schemaVersion !== 1 || envelope.observationClass !== HOST_OBSERVATION_CLASS) {
		throw new Error('Reference host observation identity is invalid.');
	}
	return validateReferenceFingerprint(envelope.fingerprint);
}

/** Merge only after every independently observed overlapping value agrees. */
export function mergeM4ParityReferenceFingerprint(hostInput, browserInput) {
	const host = validateReferenceFingerprint(hostInput);
	const browser = validateBrowserObservation(browserInput);
	for (const field of BROWSER_OBSERVATION_FIELDS) {
		if (!deepEqualJson(host[field], browser[field])) {
			throw new Error(`Browser-observed reference field ${field} does not match the host observation.`);
		}
	}
	return Object.freeze({ ...host, ...browser });
}

function isProvisionedReferenceEnvironment(environment) {
	return environment.status === 'active'
		&& environment.qualificationEligible === true
		&& Array.isArray(environment.eligibleWorkloadIds)
		&& environment.eligibleWorkloadIds.includes(M4_PARITY_WORKLOAD_ID)
		&& isRecord(environment.fingerprint)
		&& isValidReferenceFingerprint(environment.fingerprint);
}

function isValidReferenceFingerprint(value) {
	try {
		validateReferenceFingerprint(value);
		return true;
	} catch {
		return false;
	}
}

function validateReferenceFingerprint(value) {
	const fingerprint = requireExactRecord(
		snapshotStrictJsonData(value, 'reference fingerprint'),
		M4_PARITY_REFERENCE_FINGERPRINT_FIELDS,
		'reference fingerprint',
	);
	for (const field of [
		'osImage', 'osUpdatePolicy', 'cpuModel', 'gpuModel', 'gpuDriver',
		'webglVendor', 'webglRenderer', 'displayMode', 'powerProfile', 'browserVersion',
	]) boundedString(fingerprint[field], field);
	for (const field of ['logicalCpuCount', 'memoryBytes', 'gpuMemoryBytes']) {
		if (!Number.isSafeInteger(fingerprint[field]) || fingerprint[field] < 1) {
			throw new Error(`Reference fingerprint ${field} must be a positive safe integer.`);
		}
	}
	for (const field of ['displayRefreshHz', 'devicePixelRatio']) {
		if (!Number.isFinite(fingerprint[field]) || fingerprint[field] <= 0) {
			throw new Error(`Reference fingerprint ${field} must be positive and finite.`);
		}
	}
	if (typeof fingerprint.browserBinarySha256 !== 'string'
		|| !/^[a-f\d]{64}$/u.test(fingerprint.browserBinarySha256)) {
		throw new Error('Reference fingerprint browserBinarySha256 must be one lowercase SHA-256.');
	}
	validateStringArray(fingerprint.browserLaunchFlags, 'browserLaunchFlags', true);
	validateStringArray(fingerprint.runnerLabels, 'runnerLabels', false);
	return Object.freeze(fingerprint);
}

function validateBrowserObservation(value) {
	const observation = requireExactRecord(
		snapshotStrictJsonData(value, 'browser reference observation'),
		BROWSER_OBSERVATION_FIELDS,
		'browser reference observation',
	);
	for (const field of ['osImage', 'cpuModel', 'webglVendor', 'webglRenderer', 'browserVersion']) {
		boundedString(observation[field], field);
	}
	for (const field of ['logicalCpuCount', 'memoryBytes']) {
		if (!Number.isSafeInteger(observation[field]) || observation[field] < 1) {
			throw new Error(`Browser reference observation ${field} must be a positive safe integer.`);
		}
	}
	if (!Number.isFinite(observation.devicePixelRatio) || observation.devicePixelRatio <= 0) {
		throw new Error('Browser reference observation devicePixelRatio must be positive and finite.');
	}
	if (typeof observation.browserBinarySha256 !== 'string'
		|| !/^[a-f\d]{64}$/u.test(observation.browserBinarySha256)) {
		throw new Error('Browser reference observation browserBinarySha256 must be one lowercase SHA-256.');
	}
	return Object.freeze(observation);
}

function requireExactRecord(value, fields, path) {
	const record = requireRecord(value, path);
	if (!deepEqualJson(Object.keys(record).sort(), [...fields].sort())) {
		throw new Error(`${path} must contain the exact fields.`);
	}
	return record;
}

function boundedString(value, field) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new Error(`Reference observation ${field} must be a bounded string.`);
	}
}

function validateStringArray(value, field, allowEmpty) {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 128
		|| value.some((entry) => typeof entry !== 'string' || entry.length < 1 || entry.length > 512)
		|| new Set(value).size !== value.length) {
		throw new Error(`Reference fingerprint ${field} must be a bounded unique string array.`);
	}
}

function exactDescriptor(collection, id, label) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
}

function requireRecord(value, path) {
	if (!isRecord(value)) throw new Error(`${path} must be a plain record.`);
	return value;
}

function isRecord(value) {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepEqualJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function ownEnvironmentString(environment, key) {
	if (environment === null || (typeof environment !== 'object' && typeof environment !== 'function')) {
		throw new Error('Collector environment must expose own data properties.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(environment, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')
		|| (descriptor.value !== undefined && typeof descriptor.value !== 'string')) {
		throw new Error(`Collector environment ${key} must be an own string data property.`);
	}
	return descriptor.value;
}
