/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { M5B_QUALITY_PIPELINES, m5bQualityBudgetSha256 } from '../scripts/lib/m5b-quality-pipeline.mjs';
import {
	createM5bQualityResultV2,
	validateM5bQualityMeasurementV2,
} from '../scripts/lib/m5b-quality-pipeline-v2.mjs';
import {
	M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2,
	createM5bQualityCohortV2,
} from '../scripts/lib/m5b-quality-cohort-v2.mjs';
import { collectM5bQualityCurrent } from '../scripts/lib/m5b-quality-collector.mjs';
import { M5B_V2_EXERCISED_CAPABILITIES } from '../scripts/lib/m5b-quality-observations-v2.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
));

function measurement(profileId = 'native-media') {
	const pipeline = M5B_QUALITY_PIPELINES[profileId as keyof typeof M5B_QUALITY_PIPELINES];
	const workload = config.workloads.find(({ id }: { readonly id: string }) => id === pipeline.workloadId);
	const observations = Object.fromEntries(workload.thresholds.map((threshold: { metricId: string; value: number }) => [
		threshold.metricId,
		[threshold.value],
	]));
	return {
		schemaVersion: 2,
		budgetSha256: m5bQualityBudgetSha256(config),
		sourceRevision: 'a'.repeat(40),
		attemptCount: 1,
		retryCount: 0,
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: 'native-os-lab-matrix',
		platformId: 'linuxX64',
		observedRuntimeProfile: {
			platformId: 'linuxX64', architecture: 'x64', osImage: 'Soundscaper native lab',
			osVersion: '1.0', gpuModel: 'Lab GPU', driverVersion: '1.0',
			displayIdentity: 'Lab display', rendererClass: 'hardware', mediaDecodeBackend: 'vaapi',
			mediaEncodeBackend: 'vaapi', ofxGpuBackend: 'opengl', displayServer: 'x11',
			packageSha256: '1'.repeat(64), mediaHostSha256: '3'.repeat(64),
			helperBinarySha256: '2'.repeat(64), nativeAddonSha256: null,
			workloadRunnerSha256: '4'.repeat(64),
			ofxScannerSha256: profileId === 'openfx' ? '5'.repeat(64) : null,
			ofxRuntimeHostSha256: profileId === 'openfx' ? '6'.repeat(64) : null,
			exercisedCapabilityIds: M5B_V2_EXERCISED_CAPABILITIES[profileId],
		},
		labBinding: {
			schemaVersion: 2,
			environmentId: 'native-os-lab-matrix',
			platformId: 'linuxX64',
			profileId: 'framescaper-linux-x64-vaapi-opengl-x11',
			physicalHost: {
				hostId: 'lab-linux-x64-01',
				platformId: 'linuxX64',
				architecture: 'x64',
				osImage: 'Soundscaper native lab',
				osVersion: '1.0',
				cpuModel: 'Lab CPU',
				logicalCpuCount: 16,
				memoryBytes: 34_359_738_368,
				gpuModel: 'Lab GPU',
				driverVersion: '1.0',
				audioInterfaceModel: 'Lab audio',
				audioDriverVersion: '1.0',
				displayIdentity: 'Lab display',
			},
			artifacts: {
				sourceRevision: 'a'.repeat(40),
				packageSha256: '1'.repeat(64),
				helperBinarySha256: '2'.repeat(64),
				nativeAddonSha256: null,
				mediaHostSha256: '3'.repeat(64),
				workloadRunnerSha256: '4'.repeat(64),
				ofxScannerSha256: profileId === 'openfx' ? '5'.repeat(64) : null,
				ofxRuntimeHostSha256: profileId === 'openfx' ? '6'.repeat(64) : null,
			},
		},
		observations,
	};
}

function cohortMeasurement(labProfileId: string) {
	const candidate = measurement();
	const profile = config.environments
		.find(({ id }: { readonly id: string }) => id === 'native-os-lab-matrix')
		.profiles.find(({ id }: { readonly id: string }) => id === labProfileId);
	const architecture = profile.platformId === 'windowsX64' || profile.platformId === 'linuxX64'
		? 'x64'
		: 'arm64';
	candidate.platformId = profile.platformId;
	candidate.labBinding.platformId = profile.platformId;
	candidate.labBinding.profileId = labProfileId;
	candidate.observedRuntimeProfile.platformId = profile.platformId;
	candidate.observedRuntimeProfile.architecture = architecture;
	candidate.observedRuntimeProfile.mediaDecodeBackend = profile.mediaDecodeBackend;
	candidate.observedRuntimeProfile.mediaEncodeBackend = profile.mediaEncodeBackend;
	candidate.observedRuntimeProfile.ofxGpuBackend = profile.ofxGpuBackend;
	candidate.observedRuntimeProfile.displayServer = profile.displayServer;
	candidate.labBinding.physicalHost = {
		...candidate.labBinding.physicalHost,
		hostId: `lab-${profile.platformId}-01`,
		platformId: profile.platformId,
		architecture,
	};
	return candidate;
}

test('all five 5B pipelines accept the separated V2 lab binding', () => {
	for (const profileId of Object.keys(M5B_QUALITY_PIPELINES)) {
		const candidate = measurement(profileId);
		const validated = validateM5bQualityMeasurementV2(profileId, candidate, config);
		assert.equal(validated.schemaVersion, 2);
		assert.equal(validated.labBinding.profile.productId, 'framescaper');
		assert.equal(validated.labBinding.artifacts.mediaHostSha256, '3'.repeat(64));
		assert.deepEqual(validated.metrics, Object.fromEntries(Object.entries(candidate.observations)
			.map(([metricId, samples]) => [metricId, samples[0]])));
		const result = createM5bQualityResultV2(profileId, candidate, config);
		assert.equal(result.status, 'pending-external');
		assert.equal(result.metricGatePassed, true);
		assert.equal(result.qualificationEvidencePublished, false);
		assert.ok(result.qualificationBlockers.some((blocker: string) => /handoff gate/iu.test(blocker)));
	}
});

test('5B V2 rejects a V1 shape, profile relabelling, and missing OFX payload digests', () => {
	assert.throws(
		() => validateM5bQualityMeasurementV2('native-media', { ...measurement(), schemaVersion: 1 }, config),
		/schemaVersion must be 2/iu,
	);
	const relabelled = measurement();
	relabelled.labBinding.profileId = 'soundscaper-linux-x64-pipewire';
	assert.throws(
		() => validateM5bQualityMeasurementV2('native-media', relabelled, config),
		/Framescaper/iu,
	);
	const openfx = measurement('openfx');
	openfx.labBinding.artifacts.ofxScannerSha256 = null;
	assert.throws(
		() => validateM5bQualityMeasurementV2('openfx', openfx, config),
		/scanner and runtime-host digests/iu,
	);
	const relabelledRuntime = measurement();
	relabelledRuntime.observedRuntimeProfile.displayServer = 'xwayland';
	assert.throws(() => validateM5bQualityMeasurementV2('native-media', relabelledRuntime, config),
		/observed runtime profile/iu);
});

test('a complete V2 cohort covers both Linux display systems and all five targets', () => {
	const measurements = M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.map(cohortMeasurement);
	const cohort = createM5bQualityCohortV2('native-media', measurements, config);
	assert.equal(cohort.schemaVersion, 2);
	assert.equal(cohort.status, 'pending-external');
	assert.equal(cohort.profiles.length, M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.length);
	assert.ok(cohort.labProfileIds.some((id: string) => id.endsWith('-x11')));
	assert.ok(cohort.labProfileIds.some((id: string) => id.endsWith('-xwayland')));
	assert.equal(cohort.qualificationEvidencePublished, false);

	assert.throws(
		() => createM5bQualityCohortV2('native-media', measurements.slice(1), config),
		/requires exactly/iu,
	);
	const crossRevision = structuredClone(measurements);
	crossRevision[0].sourceRevision = 'b'.repeat(40);
	crossRevision[0].labBinding.artifacts.sourceRevision = 'b'.repeat(40);
	assert.throws(
		() => createM5bQualityCohortV2('native-media', crossRevision, config),
		/same source revision/iu,
	);
});

test('the current collector routes V2 records to the digest-bound V2 writer', async () => {
	const candidate = measurement();
	let written: unknown = null;
	const collected = await collectM5bQualityCurrent('native-media', {
		measurementPath: '/lab/native-media.json',
		workloadCommand: null,
		outputDirectory: '/unused',
	}, {
		config,
		processEnvironment: {},
		readMeasurement: async (path: string) => {
			assert.equal(path, '/lab/native-media.json');
			return candidate;
		},
		writeV2Result: async (directory: string, profileId: string, raw: unknown, result: unknown) => {
			written = { directory, profileId, raw, result };
			return written;
		},
	});
	assert.equal(collected, written);
	assert.equal((written as { directory: string }).directory, '/unused');
	assert.equal((written as { profileId: string }).profileId, 'native-media');
});
