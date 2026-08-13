/* SPDX-License-Identifier: AGPL-3.0-only */

export const M4_PARITY_REFERENCE_ENVIRONMENT_ID = 'reference-linux-gpu-01';
export const M4_PARITY_HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.61.1';
export const M4_PARITY_LOCAL_ENVIRONMENT_ID = 'local-browser-correctness';
export const M4_PARITY_WORKLOAD_ID = 'm4-production-render-parity';

const REFERENCE_FINGERPRINT_FIELDS = Object.freeze([
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

/** Resolve correctness versus explicitly provisioned reference collection identity. */
export function resolveM4ParityCollectionEnvironment(options, config, processEnvironment = {}) {
	const record = requireRecord(options, 'collector options');
	const qualificationMode = record.qualificationMode ?? 'correctness';
	if (qualificationMode === 'correctness') {
		return Object.freeze({
			qualificationMode,
			environmentId: processEnvironment.GITHUB_ACTIONS === 'true'
				? M4_PARITY_HOSTED_ENVIRONMENT_ID
				: M4_PARITY_LOCAL_ENVIRONMENT_ID,
			expectedFingerprint: null,
		});
	}
	if (qualificationMode !== 'reference') {
		throw new Error('M4 collection qualificationMode must be correctness or reference.');
	}
	const environment = exactDescriptor(
		requireRecord(config, 'config').environments,
		M4_PARITY_REFERENCE_ENVIRONMENT_ID,
		'environment',
	);
	if (!isProvisionedReferenceEnvironment(environment)) {
		throw new Error('Reference collection requires an active eligible provisioned descriptor.');
	}
	return Object.freeze({
		qualificationMode,
		environmentId: M4_PARITY_REFERENCE_ENVIRONMENT_ID,
		expectedFingerprint: Object.freeze(snapshotJsonData(
			environment.fingerprint,
			'reference environment fingerprint',
		)),
	});
}

/** Parse an explicit mode without letting default correctness claim reference identity. */
export function parseM4ParityCliOptions(args, environment = {}) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M4 collector CLI arguments must be strings.');
	}
	let qualificationMode = environment.SOUNDSCAPER_M4_REFERENCE_QUALIFICATION === '1'
		? 'reference'
		: 'correctness';
	let outputDirectory = null;
	for (const argument of args) {
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
	if (diagnostic.environmentId !== collectionEnvironment.environmentId) {
		throw new Error('Browser diagnostic relabeled its collection environment.');
	}
	if (collectionEnvironment.qualificationMode === 'reference'
		&& !deepEqualJson(
			diagnostic.environmentFingerprint,
			collectionEnvironment.expectedFingerprint,
		)) {
		throw new Error('Browser-observed reference fingerprint does not match the provisioned descriptor.');
	}
}

function isProvisionedReferenceEnvironment(environment) {
	return environment.status === 'active'
		&& environment.qualificationEligible === true
		&& Array.isArray(environment.eligibleWorkloadIds)
		&& environment.eligibleWorkloadIds.includes(M4_PARITY_WORKLOAD_ID)
		&& isRecord(environment.fingerprint)
		&& hasExactFields(environment.fingerprint, REFERENCE_FINGERPRINT_FIELDS)
		&& !containsNullish(environment.fingerprint);
}

function containsNullish(value) {
	if (value === null || value === undefined) return true;
	if (Array.isArray(value)) return value.some(containsNullish);
	if (isRecord(value)) return Object.values(value).some(containsNullish);
	return false;
}

function hasExactFields(value, fields) {
	return deepEqualJson(Object.keys(value).sort(), [...fields].sort());
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

function snapshotJsonData(value, path) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON data.`);
		return value;
	}
	if (Array.isArray(value)) return value.map((entry, index) => snapshotJsonData(entry, `${path}[${index}]`));
	if (!isRecord(value)) throw new Error(`${path} must contain only plain JSON data.`);
	const result = {};
	for (const [key, entry] of Object.entries(value)) result[key] = snapshotJsonData(entry, `${path}.${key}`);
	return result;
}

function deepEqualJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
