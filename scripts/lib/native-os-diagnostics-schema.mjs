/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	boundedString,
	deepFreeze,
	exactRecord,
	positiveInteger,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID = 'native-os-diagnostics';
export const NATIVE_OS_DIAGNOSTICS_PLATFORM_IDS = Object.freeze([
	'windowsX64', 'windowsArm64', 'macosArm64', 'linuxX64', 'linuxArm64',
]);

const PLATFORM_ARCHITECTURES = Object.freeze({
	windowsX64: 'x64',
	windowsArm64: 'arm64',
	macosArm64: 'arm64',
	linuxX64: 'x64',
	linuxArm64: 'arm64',
});
const ENVIRONMENT_FIELDS = Object.freeze([
	'id', 'status', 'kind', 'rendererRequirement', 'evidence',
]);
const HOST_FIELDS = Object.freeze([
	'hostId', 'platformId', 'architecture', 'osImage', 'osVersion', 'cpuModel',
	'logicalCpuCount', 'memoryBytes', 'gpuModel', 'driverVersion',
	'audioInterfaceModel', 'audioDriverVersion', 'displayIdentity',
]);
const ARTIFACT_FIELDS = Object.freeze([
	'sourceRevision', 'packageSha256', 'helperBinarySha256', 'nativeAddonSha256',
	'mediaHostSha256', 'workloadRunnerSha256', 'ofxScannerSha256', 'ofxRuntimeHostSha256',
]);
const BINDING_FIELDS = Object.freeze([
	'schemaVersion', 'environmentId', 'platformId', 'observedHost', 'artifacts',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

/** Validate the neutral environment used by local native diagnostic collectors. */
export function validateNativeOsDiagnosticsEnvironment(value) {
	const environment = exactRecord(
		snapshotStrictJsonData(value, 'native OS diagnostics environment'),
		ENVIRONMENT_FIELDS,
		'native OS diagnostics environment',
	);
	if (environment.id !== NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID
		|| environment.status !== 'active'
		|| environment.kind !== 'observed-native-runtime-diagnostics'
		|| environment.rendererRequirement !== 'any') {
		throw new Error('Native OS diagnostics environment has an unsupported descriptor.');
	}
	if (!Array.isArray(environment.evidence) || environment.evidence.length === 0) {
		throw new Error('Native OS diagnostics environment must point at its runnable checks.');
	}
	const evidence = environment.evidence.map((entry, index) => (
		boundedString(entry, 1, 4_096, `native OS diagnostics evidence[${index}]`)
	));
	return deepFreeze({ ...environment, evidence });
}

/**
 * Bind one diagnostic to the host and artifacts that actually ran it.
 * No configured lab row, hardware cohort, or release claim is implied.
 */
export function validateNativeOsDiagnosticBinding(value, environmentValue) {
	validateNativeOsDiagnosticsEnvironment(environmentValue);
	const binding = exactRecord(
		snapshotStrictJsonData(value, 'native OS diagnostic binding'),
		BINDING_FIELDS,
		'native OS diagnostic binding',
	);
	if (binding.schemaVersion !== 2
		|| binding.environmentId !== NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID) {
		throw new Error('Native OS diagnostic binding must use schemaVersion 2 and its diagnostic environment.');
	}
	const platformId = platform(binding.platformId, 'native OS diagnostic platformId');
	const observedHost = validateObservedHost(binding.observedHost, platformId);
	const artifacts = validateArtifacts(binding.artifacts);
	return deepFreeze({
		schemaVersion: 2,
		environmentId: NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID,
		platformId,
		observedHost,
		artifacts,
	});
}

function validateObservedHost(value, platformId) {
	const host = exactRecord(value, HOST_FIELDS, 'native OS diagnostic observed host');
	if (host.platformId !== platformId || host.architecture !== PLATFORM_ARCHITECTURES[platformId]) {
		throw new Error(`Native OS diagnostic host identity does not match ${platformId}.`);
	}
	for (const field of HOST_FIELDS.filter((field) => !['logicalCpuCount', 'memoryBytes'].includes(field))) {
		boundedString(host[field], 1, 1_024, `native OS diagnostic observedHost.${field}`);
	}
	positiveInteger(host.logicalCpuCount, 'native OS diagnostic observedHost.logicalCpuCount');
	positiveInteger(host.memoryBytes, 'native OS diagnostic observedHost.memoryBytes');
	return deepFreeze({ ...host });
}

function validateArtifacts(value) {
	const artifacts = exactRecord(value, ARTIFACT_FIELDS, 'native OS diagnostic artifacts');
	if (!SOURCE_REVISION.test(String(artifacts.sourceRevision))) {
		throw new Error('Native OS diagnostic artifacts.sourceRevision must be one Git object ID.');
	}
	for (const field of ARTIFACT_FIELDS.slice(1)) {
		if (artifacts[field] !== null && !SHA256.test(String(artifacts[field]))) {
			throw new Error(`Native OS diagnostic artifacts.${field} must be a SHA-256 or null.`);
		}
	}
	for (const field of ['packageSha256', 'workloadRunnerSha256']) {
		if (!SHA256.test(String(artifacts[field]))) {
			throw new Error(`Native OS diagnostic artifacts.${field} is required.`);
		}
	}
	return deepFreeze({ ...artifacts });
}

function platform(value, path) {
	if (typeof value !== 'string' || !Object.hasOwn(PLATFORM_ARCHITECTURES, value)) {
		throw new Error(`${path} is unsupported.`);
	}
	return value;
}
