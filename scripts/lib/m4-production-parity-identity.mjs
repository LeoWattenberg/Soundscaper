/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const M4_PARITY_HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.62.1';
export const M4_PARITY_LOCAL_ENVIRONMENT_ID = 'local-runtime-diagnostics';
export const M4_PARITY_WORKLOAD_ID = 'm4-production-render-parity';

const PACKAGED_RUNTIME_ENVIRONMENT_ID = /^packaged-runtime-(?:linux|win32|darwin)-(?:x64|arm64)$/u;

/** Resolve the diagnostic identity used by hosted and local runs. */
export function resolveM4ParityCollectionEnvironment(options, _config, processEnvironment = {}) {
	const record = requireRecord(
		snapshotStrictJsonData(options, 'collector options'),
		'collector options',
	);
	if (Object.keys(record).some((field) => field !== 'outputDirectory')) {
		throw new Error('M4 collector options must contain the exact fields.');
	}
	const observedEnvironmentId = ownEnvironmentString(
		processEnvironment,
		'SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID',
	);
	const environmentId = observedEnvironmentId
		?? (ownEnvironmentString(processEnvironment, 'GITHUB_ACTIONS') === 'true'
			? M4_PARITY_HOSTED_ENVIRONMENT_ID
			: M4_PARITY_LOCAL_ENVIRONMENT_ID);
	if (!isM4ParityDiagnosticEnvironmentId(environmentId)) {
		throw new Error(`M4 collection environment ${String(environmentId)} is not an admitted diagnostic environment.`);
	}
	return Object.freeze({ environmentId });
}

/** Parse one optional output directory. */
export function parseM4ParityCliOptions(args) {
	const values = snapshotStrictJsonData(args, 'M4 collector CLI arguments');
	if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
		throw new TypeError('M4 collector CLI arguments must be strings.');
	}
	let outputDirectory = null;
	for (const argument of values) {
		if (argument.startsWith('-')) throw new Error(`Unknown M4 collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M4 collector accepts one output directory.');
		outputDirectory = argument;
	}
	return Object.freeze({ outputDirectory });
}

/** Require the browser to report the diagnostic identity selected by the runner. */
export function assertM4ParityCollectionEnvironment(diagnostic, collectionEnvironment) {
	const observed = requireRecord(
		snapshotStrictJsonData(diagnostic, 'browser diagnostic'),
		'browser diagnostic',
	);
	const expected = requireRecord(
		snapshotStrictJsonData(collectionEnvironment, 'collection environment'),
		'collection environment',
	);
	if (observed.environmentId !== expected.environmentId) {
		throw new Error('Browser diagnostic relabeled its collection environment.');
	}
}

export function isM4ParityDiagnosticEnvironmentId(value) {
	return [M4_PARITY_LOCAL_ENVIRONMENT_ID, M4_PARITY_HOSTED_ENVIRONMENT_ID].includes(value)
		|| (typeof value === 'string' && PACKAGED_RUNTIME_ENVIRONMENT_ID.test(value));
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
