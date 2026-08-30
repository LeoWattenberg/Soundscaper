/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDeepStrictEqual } from 'node:util';

import {
	boundedString,
	deepFreeze,
	exactRecord,
	positiveInteger,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const NATIVE_OS_LAB_ENVIRONMENT_ID = 'native-os-lab-matrix';
export const NATIVE_OS_LAB_PLATFORM_IDS = Object.freeze([
	'windowsX64', 'windowsArm64', 'macosArm64', 'linuxX64', 'linuxArm64',
]);

const PLATFORM_ARCHITECTURES = Object.freeze({
	windowsX64: 'x64',
	windowsArm64: 'arm64',
	macosArm64: 'arm64',
	linuxX64: 'x64',
	linuxArm64: 'arm64',
});
const PROFILE_FIELDS = Object.freeze([
	'id', 'productId', 'platformId', 'audioBackend', 'audioMode',
	'audioSampleRate', 'audioBufferFrames',
	'mediaDecodeBackend', 'mediaEncodeBackend', 'ofxGpuBackend', 'displayServer',
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
	'schemaVersion', 'environmentId', 'platformId', 'profileId', 'physicalHost', 'artifacts',
]);
const HANDOFF_GATE_FIELDS = Object.freeze([
	'legalAndTrademarkReview',
	'nativeIsolationSecurityReview',
	'productionSigningAndNotarization',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const profile = (id, productId, platformId, values) => Object.freeze({
	id,
	productId,
	platformId,
	audioBackend: null,
	audioMode: null,
	audioSampleRate: null,
	audioBufferFrames: null,
	mediaDecodeBackend: null,
	mediaEncodeBackend: null,
	ofxGpuBackend: null,
	displayServer: null,
	...values,
});

export const NATIVE_OS_LAB_PROFILES_V2 = Object.freeze([
	profile('soundscaper-windows-x64-wasapi-shared', 'soundscaper', 'windowsX64',
		{ audioBackend: 'wasapi', audioMode: 'shared', audioSampleRate: 48_000, audioBufferFrames: 256 }),
	profile('soundscaper-windows-x64-wasapi-exclusive', 'soundscaper', 'windowsX64',
		{ audioBackend: 'wasapi', audioMode: 'exclusive', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-windows-x64-asio', 'soundscaper', 'windowsX64',
		{ audioBackend: 'asio', audioMode: 'direct', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-windows-arm64-wasapi-shared', 'soundscaper', 'windowsArm64',
		{ audioBackend: 'wasapi', audioMode: 'shared', audioSampleRate: 48_000, audioBufferFrames: 256 }),
	profile('soundscaper-windows-arm64-wasapi-exclusive', 'soundscaper', 'windowsArm64',
		{ audioBackend: 'wasapi', audioMode: 'exclusive', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-windows-arm64-asio', 'soundscaper', 'windowsArm64',
		{ audioBackend: 'asio', audioMode: 'direct', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-macos-arm64-coreaudio', 'soundscaper', 'macosArm64',
		{ audioBackend: 'coreaudio', audioMode: 'native', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-linux-x64-pipewire', 'soundscaper', 'linuxX64',
		{ audioBackend: 'pipewire', audioMode: 'shared', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-linux-x64-alsa', 'soundscaper', 'linuxX64',
		{ audioBackend: 'alsa', audioMode: 'direct', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-linux-arm64-pipewire', 'soundscaper', 'linuxArm64',
		{ audioBackend: 'pipewire', audioMode: 'shared', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('soundscaper-linux-arm64-alsa', 'soundscaper', 'linuxArm64',
		{ audioBackend: 'alsa', audioMode: 'direct', audioSampleRate: 48_000, audioBufferFrames: 128 }),
	profile('framescaper-windows-x64-d3d11va-mf-opengl', 'framescaper', 'windowsX64', {
		mediaDecodeBackend: 'd3d11va', mediaEncodeBackend: 'media-foundation',
		ofxGpuBackend: 'opengl', displayServer: 'desktop',
	}),
	profile('framescaper-windows-arm64-d3d11va-mf-opengl', 'framescaper', 'windowsArm64', {
		mediaDecodeBackend: 'd3d11va', mediaEncodeBackend: 'media-foundation',
		ofxGpuBackend: 'opengl', displayServer: 'desktop',
	}),
	profile('framescaper-macos-arm64-videotoolbox-metal', 'framescaper', 'macosArm64', {
		mediaDecodeBackend: 'videotoolbox', mediaEncodeBackend: 'videotoolbox',
		ofxGpuBackend: 'metal', displayServer: 'desktop',
	}),
	profile('framescaper-linux-x64-vaapi-opengl-x11', 'framescaper', 'linuxX64', {
		mediaDecodeBackend: 'vaapi', mediaEncodeBackend: 'vaapi',
		ofxGpuBackend: 'opengl', displayServer: 'x11',
	}),
	profile('framescaper-linux-x64-vaapi-opengl-xwayland', 'framescaper', 'linuxX64', {
		mediaDecodeBackend: 'vaapi', mediaEncodeBackend: 'vaapi',
		ofxGpuBackend: 'opengl', displayServer: 'xwayland',
	}),
	profile('framescaper-linux-arm64-vaapi-opengl-x11', 'framescaper', 'linuxArm64', {
		mediaDecodeBackend: 'vaapi', mediaEncodeBackend: 'vaapi',
		ofxGpuBackend: 'opengl', displayServer: 'x11',
	}),
	profile('framescaper-linux-arm64-vaapi-opengl-xwayland', 'framescaper', 'linuxArm64', {
		mediaDecodeBackend: 'vaapi', mediaEncodeBackend: 'vaapi',
		ofxGpuBackend: 'opengl', displayServer: 'xwayland',
	}),
]);

export const NATIVE_OS_LAB_REQUIRED_PROFILE_IDS = Object.freeze(
	NATIVE_OS_LAB_PROFILES_V2.map(({ id }) => id),
);

export function validateNativeOsLabEnvironmentV2(value) {
	const environment = requireRecord(
		snapshotStrictJsonData(value, 'native OS lab environment'),
		'native OS lab environment',
	);
	if (environment.id !== NATIVE_OS_LAB_ENVIRONMENT_ID || environment.descriptorVersion !== 2) {
		throw new Error('Native OS lab environment must be the descriptorVersion 2 matrix.');
	}
	const physicalHosts = platformRecord(environment.physicalHosts, 'native OS lab physicalHosts');
	const legacy = platformRecord(environment.fingerprint, 'native OS lab legacy V1 fingerprint');
	const handoffGates = exactRecord(
		environment.handoffGates,
		HANDOFF_GATE_FIELDS,
		'native OS lab handoffGates',
	);
	for (const field of HANDOFF_GATE_FIELDS) {
		if (!['pending-external', 'accepted'].includes(handoffGates[field])) {
			throw new Error(`Native OS lab handoff gate ${field} has an unsupported status.`);
		}
	}
	for (const platformId of NATIVE_OS_LAB_PLATFORM_IDS) {
		if (physicalHosts[platformId] !== null) validatePhysicalHost(physicalHosts[platformId], platformId);
		if (legacy[platformId] !== null && typeof legacy[platformId] !== 'object') {
			throw new Error(`Native OS lab legacy V1 fingerprint ${platformId} must be a record or null.`);
		}
	}
	if (!Array.isArray(environment.profiles)
		|| environment.profiles.length !== NATIVE_OS_LAB_PROFILES_V2.length) {
		throw new Error('Native OS lab environment must enumerate the exact V2 product profiles.');
	}
	const profiles = environment.profiles.map((candidate, index) => validateProfile(candidate, index));
	if (!isDeepStrictEqual(profiles, NATIVE_OS_LAB_PROFILES_V2)) {
		throw new Error('Native OS lab environment profiles do not match the frozen V2 matrix.');
	}
	return deepFreeze({ ...environment, physicalHosts, profiles, handoffGates });
}

export function findNativeOsLabProfile(environmentValue, profileIdValue) {
	const environment = validateNativeOsLabEnvironmentV2(environmentValue);
	const profileId = boundedString(profileIdValue, 1, 160, 'native OS lab profileId');
	const matches = environment.profiles.filter(({ id }) => id === profileId);
	if (matches.length !== 1) throw new Error(`Native OS lab profile ${profileId} is not registered.`);
	return matches[0];
}

export function validateNativeOsLabMeasurementBindingV2(value, environmentValue) {
	const binding = exactRecord(
		snapshotStrictJsonData(value, 'native OS lab measurement binding'),
		BINDING_FIELDS,
		'native OS lab measurement-binding',
	);
	if (binding.schemaVersion !== 2 || binding.environmentId !== NATIVE_OS_LAB_ENVIRONMENT_ID) {
		throw new Error('Native OS lab measurement binding must use schemaVersion 2 and the native matrix.');
	}
	const platformId = platform(binding.platformId, 'native OS lab measurement platformId');
	const profileEntry = findNativeOsLabProfile(environmentValue, binding.profileId);
	if (profileEntry.platformId !== platformId) {
		throw new Error(`Native OS lab profile ${profileEntry.id} does not belong to platform ${platformId}.`);
	}
	const physicalHost = validatePhysicalHost(binding.physicalHost, platformId);
	const artifacts = validateArtifacts(binding.artifacts);
	return deepFreeze({
		schemaVersion: 2,
		environmentId: NATIVE_OS_LAB_ENVIRONMENT_ID,
		platformId,
		profileId: profileEntry.id,
		profile: profileEntry,
		physicalHost,
		artifacts,
	});
}

export function assessNativeOsLabBindingQualificationV2(
	environmentValue,
	bindingValue,
	workloadIdValue,
) {
	const environment = validateNativeOsLabEnvironmentV2(environmentValue);
	const binding = validateNativeOsLabMeasurementBindingV2(bindingValue, environment);
	const workloadId = boundedString(workloadIdValue, 1, 160, 'native OS lab workloadId');
	const blockers = [];
	if (environment.status !== 'active') {
		blockers.push(`Environment ${NATIVE_OS_LAB_ENVIRONMENT_ID} is ${String(environment.status)}.`);
	}
	if (environment.qualificationEligible !== true) {
		blockers.push(`Environment ${NATIVE_OS_LAB_ENVIRONMENT_ID} is not qualification-eligible.`);
	}
	if (!Array.isArray(environment.eligibleWorkloadIds)
		|| !environment.eligibleWorkloadIds.includes(workloadId)) {
		blockers.push(`Environment ${NATIVE_OS_LAB_ENVIRONMENT_ID} does not list ${workloadId} as an eligible workload.`);
	}
	const registeredHost = environment.physicalHosts[binding.platformId];
	if (registeredHost === null) {
		blockers.push(`Environment ${NATIVE_OS_LAB_ENVIRONMENT_ID} has no physical host for ${binding.platformId}.`);
	} else if (!isDeepStrictEqual(registeredHost, binding.physicalHost)) {
		blockers.push(`Environment ${NATIVE_OS_LAB_ENVIRONMENT_ID} physical host for ${binding.platformId} does not match the observation.`);
	}
	const gates = requireRecord(environment.handoffGates, 'native OS lab handoffGates');
	for (const field of HANDOFF_GATE_FIELDS) {
		if (gates[field] !== 'accepted') {
			blockers.push(`Environment ${NATIVE_OS_LAB_ENVIRONMENT_ID} handoff gate ${field} is ${String(gates[field])}.`);
		}
	}
	return deepFreeze({ binding, blockers, provisioned: blockers.length === 0 });
}

function validateProfile(value, index) {
	const candidate = exactRecord(value, PROFILE_FIELDS, `native OS lab profiles[${index}]`);
	boundedString(candidate.id, 1, 160, `native OS lab profiles[${index}].id`);
	if (!['soundscaper', 'framescaper'].includes(candidate.productId)) {
		throw new Error(`Native OS lab profile ${candidate.id} product is unsupported.`);
	}
	platform(candidate.platformId, `native OS lab profile ${candidate.id} platformId`);
	for (const field of PROFILE_FIELDS.slice(3)) {
		if (candidate[field] === null) continue;
		if (['audioSampleRate', 'audioBufferFrames'].includes(field)) {
			positiveInteger(candidate[field], `native OS lab profile ${candidate.id}.${field}`);
		} else boundedString(candidate[field], 1, 80, `native OS lab profile ${candidate.id}.${field}`);
	}
	return deepFreeze({ ...candidate });
}

function validatePhysicalHost(value, platformId) {
	const host = exactRecord(value, HOST_FIELDS, 'native OS lab exact physical-host');
	if (host.platformId !== platformId || host.architecture !== PLATFORM_ARCHITECTURES[platformId]) {
		throw new Error(`Native OS lab physical host identity does not match ${platformId}.`);
	}
	for (const field of HOST_FIELDS.filter((field) => !['logicalCpuCount', 'memoryBytes'].includes(field))) {
		boundedString(host[field], 1, 1_024, `native OS lab physicalHost.${field}`);
	}
	positiveInteger(host.logicalCpuCount, 'native OS lab physicalHost.logicalCpuCount');
	positiveInteger(host.memoryBytes, 'native OS lab physicalHost.memoryBytes');
	return deepFreeze({ ...host });
}

function validateArtifacts(value) {
	const artifacts = exactRecord(value, ARTIFACT_FIELDS, 'native OS lab artifacts');
	if (!SOURCE_REVISION.test(String(artifacts.sourceRevision))) {
		throw new Error('Native OS lab artifacts.sourceRevision must be one Git object ID.');
	}
	for (const field of ARTIFACT_FIELDS.slice(1)) {
		if (artifacts[field] !== null && !SHA256.test(String(artifacts[field]))) {
			throw new Error(`Native OS lab artifacts.${field} must be a SHA-256 or null.`);
		}
	}
	for (const field of ['packageSha256', 'workloadRunnerSha256']) {
		if (!SHA256.test(String(artifacts[field]))) {
			throw new Error(`Native OS lab artifacts.${field} is required.`);
		}
	}
	return deepFreeze({ ...artifacts });
}

function platformRecord(value, path) {
	return exactRecord(value, NATIVE_OS_LAB_PLATFORM_IDS, path);
}

function platform(value, path) {
	if (typeof value !== 'string' || !Object.hasOwn(PLATFORM_ARCHITECTURES, value)) {
		throw new Error(`${path} is unsupported.`);
	}
	return value;
}
