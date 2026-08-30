/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	NATIVE_OS_LAB_ENVIRONMENT_ID,
	NATIVE_OS_LAB_PLATFORM_IDS,
	assessNativeOsLabBindingQualificationV2,
	findNativeOsLabProfile,
	validateNativeOsLabEnvironmentV2,
	validateNativeOsLabMeasurementBindingV2,
} from '../scripts/lib/native-os-lab-schema.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
));
const environment = config.environments.find(
	({ id }: { readonly id: string }) => id === NATIVE_OS_LAB_ENVIRONMENT_ID,
);

function host(platformId = 'linuxX64') {
	return {
		hostId: `lab-${platformId}-01`,
		platformId,
		architecture: platformId.endsWith('Arm64') ? 'arm64' : 'x64',
		osImage: 'Soundscaper lab image',
		osVersion: '1.0',
		cpuModel: 'Lab CPU',
		logicalCpuCount: 16,
		memoryBytes: 34_359_738_368,
		gpuModel: 'Lab GPU',
		driverVersion: '1.0',
		audioInterfaceModel: 'Lab loopback interface',
		audioDriverVersion: '1.0',
		displayIdentity: 'Lab display',
	};
}

function artifacts() {
	return {
		sourceRevision: 'a'.repeat(40),
		packageSha256: '1'.repeat(64),
		helperBinarySha256: '2'.repeat(64),
		nativeAddonSha256: '3'.repeat(64),
		mediaHostSha256: null,
		workloadRunnerSha256: '4'.repeat(64),
		ofxScannerSha256: null,
		ofxRuntimeHostSha256: null,
	};
}

test('native OS lab V2 separates physical hosts from exact product profiles', () => {
	const validated = validateNativeOsLabEnvironmentV2(environment);
	assert.equal(validated.descriptorVersion, 2);
	assert.deepEqual(Object.keys(validated.physicalHosts), NATIVE_OS_LAB_PLATFORM_IDS);
	assert.ok(Object.values(validated.physicalHosts).every((value) => value === null));

	const profileIds = validated.profiles.map(({ id }: { readonly id: string }) => id);
	assert.equal(profileIds.length, new Set(profileIds).size);
	for (const id of [
		'soundscaper-windows-x64-wasapi-shared',
		'soundscaper-windows-arm64-asio',
		'soundscaper-macos-arm64-coreaudio',
		'soundscaper-linux-x64-pipewire',
		'soundscaper-linux-arm64-alsa',
		'framescaper-windows-x64-d3d11va-mf-opengl',
		'framescaper-macos-arm64-videotoolbox-metal',
		'framescaper-linux-x64-vaapi-opengl-x11',
		'framescaper-linux-arm64-vaapi-opengl-xwayland',
	]) assert.ok(profileIds.includes(id), `missing profile ${id}`);

	assert.ok(Object.values(environment.fingerprint).every((value) => value === null),
		'the legacy V1 fingerprint rows remain inert rather than being reinterpreted');
});

test('a V2 measurement binds one host, registered configuration, and artifact set', () => {
	const measurement = validateNativeOsLabMeasurementBindingV2({
		schemaVersion: 2,
		environmentId: NATIVE_OS_LAB_ENVIRONMENT_ID,
		platformId: 'linuxX64',
		profileId: 'soundscaper-linux-x64-pipewire',
		physicalHost: host(),
		artifacts: artifacts(),
	}, environment);
	assert.equal(measurement.profile.productId, 'soundscaper');
	assert.equal(measurement.profile.audioBackend, 'pipewire');
	assert.equal(measurement.artifacts.packageSha256, '1'.repeat(64));
	assert.equal(findNativeOsLabProfile(environment, measurement.profileId).id, measurement.profileId);
});

test('native lab qualification treats record key order as non-semantic', () => {
	const physicalHost = host();
	const qualified = structuredClone(environment);
	qualified.status = 'active';
	qualified.qualificationEligible = true;
	qualified.handoffGates = Object.fromEntries(
		Object.keys(qualified.handoffGates).map((field) => [field, 'accepted']),
	);
	qualified.physicalHosts.linuxX64 = physicalHost;
	qualified.profiles = qualified.profiles.map((profile: Readonly<Record<string, unknown>>) => (
		Object.fromEntries(Object.entries(profile).reverse())
	));
	const reorderedHost = Object.fromEntries(Object.entries(physicalHost).reverse());
	const assessment = assessNativeOsLabBindingQualificationV2(qualified, {
		schemaVersion: 2,
		environmentId: NATIVE_OS_LAB_ENVIRONMENT_ID,
		platformId: 'linuxX64',
		profileId: 'soundscaper-linux-x64-pipewire',
		physicalHost: reorderedHost,
		artifacts: artifacts(),
	}, 'm5-native-helper-and-audio');
	assert.equal(assessment.provisioned, true);
	assert.deepEqual(assessment.blockers, []);
});

test('V2 bindings reject profile relabelling, embedded artifact state, and unknown fields', () => {
	const binding = {
		schemaVersion: 2,
		environmentId: NATIVE_OS_LAB_ENVIRONMENT_ID,
		platformId: 'linuxX64',
		profileId: 'soundscaper-windows-x64-wasapi-shared',
		physicalHost: host(),
		artifacts: artifacts(),
	};
	assert.throws(
		() => validateNativeOsLabMeasurementBindingV2(binding, environment),
		/profile.*platform/iu,
	);
	assert.throws(
		() => validateNativeOsLabMeasurementBindingV2({
			...binding,
			profileId: 'soundscaper-linux-x64-pipewire',
			physicalHost: { ...host(), packageSha256: '1'.repeat(64) },
		}, environment),
		/exact physical-host.*exact fields/iu,
	);
	assert.throws(
		() => validateNativeOsLabMeasurementBindingV2({ ...binding, extra: true }, environment),
		/measurement-binding.*exact fields/iu,
	);
});
