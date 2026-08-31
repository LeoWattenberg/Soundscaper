/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { M5B_QUALITY_PIPELINES, m5bQualityBudgetSha256 } from '../scripts/lib/m5b-quality-pipeline.mjs';
import {
	createM5bQualityResultV2,
	validateM5bQualityMeasurementV2,
} from '../scripts/lib/m5b-quality-pipeline-v2.mjs';
import { collectM5bQualityCurrent } from '../scripts/lib/m5b-quality-collector.mjs';
import { M5B_V2_EXERCISED_CAPABILITIES } from '../scripts/lib/m5b-quality-observations-v2.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
));

function measurement(profileId = 'native-media') {
	const pipeline = M5B_QUALITY_PIPELINES[profileId as keyof typeof M5B_QUALITY_PIPELINES];
	const workload = config.workloads.find(
		({ id }: { readonly id: string }) => id === pipeline.workloadId,
	);
	const observations = Object.fromEntries(workload.thresholds.map(
		(threshold: { metricId: string; value: number }) => [threshold.metricId, [threshold.value]],
	));
	return {
		schemaVersion: 2,
		budgetSha256: m5bQualityBudgetSha256(config),
		sourceRevision: 'a'.repeat(40),
		attemptCount: 1,
		retryCount: 0,
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: 'native-os-diagnostics',
		platformId: 'linuxX64',
		observedRuntimeProfile: {
			platformId: 'linuxX64', architecture: 'x64', osImage: 'Observed Linux host',
			osVersion: '1.0', gpuModel: 'Observed GPU', driverVersion: '1.0',
			displayIdentity: 'Observed display', rendererClass: 'hardware',
			mediaDecodeBackend: 'vaapi', mediaEncodeBackend: 'vaapi',
			ofxGpuBackend: 'opengl', displayServer: 'x11',
			packageSha256: '1'.repeat(64), mediaHostSha256: '3'.repeat(64),
			helperBinarySha256: '2'.repeat(64), nativeAddonSha256: null,
			workloadRunnerSha256: '4'.repeat(64),
			ofxScannerSha256: profileId === 'openfx' ? '5'.repeat(64) : null,
			ofxRuntimeHostSha256: profileId === 'openfx' ? '6'.repeat(64) : null,
			exercisedCapabilityIds: M5B_V2_EXERCISED_CAPABILITIES[profileId],
		},
		diagnosticBinding: {
			schemaVersion: 2,
			environmentId: 'native-os-diagnostics',
			platformId: 'linuxX64',
			observedHost: {
				hostId: 'diagnostic-linux-x64-01',
				platformId: 'linuxX64',
				architecture: 'x64',
				osImage: 'Observed Linux host',
				osVersion: '1.0',
				cpuModel: 'Observed CPU',
				logicalCpuCount: 16,
				memoryBytes: 34_359_738_368,
				gpuModel: 'Observed GPU',
				driverVersion: '1.0',
				audioInterfaceModel: 'Observed audio interface',
				audioDriverVersion: '1.0',
				displayIdentity: 'Observed display',
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

test('all five 5B pipelines accept one observed-host diagnostic without a lab matrix', () => {
	for (const profileId of Object.keys(M5B_QUALITY_PIPELINES)) {
		const candidate = measurement(profileId);
		const validated = validateM5bQualityMeasurementV2(profileId, candidate, config);
		assert.equal(validated.diagnosticBinding.platformId, 'linuxX64');
		assert.equal('profile' in validated.diagnosticBinding, false);
		assert.equal(validated.diagnosticBinding.artifacts.mediaHostSha256, '3'.repeat(64));
		const result = createM5bQualityResultV2(profileId, candidate, config);
		assert.equal(result.status, 'passed');
		assert.equal(result.metricGatePassed, true);
		assert.equal('qualificationEvidencePublished' in result, false);
		assert.equal('qualificationBlockers' in result, false);
	}
});

test('5B V2 rejects host relabelling and missing OpenFX artifact digests', () => {
	const relabelled = measurement();
	relabelled.observedRuntimeProfile.displayIdentity = 'Another display';
	assert.throws(
		() => validateM5bQualityMeasurementV2('native-media', relabelled, config),
		/observed runtime profile.*diagnostic binding/iu,
	);
	const openfx = measurement('openfx');
	openfx.diagnosticBinding.artifacts.ofxScannerSha256 = null;
	assert.throws(
		() => validateM5bQualityMeasurementV2('openfx', openfx, config),
		/scanner and runtime-host digests/iu,
	);
});

test('the current collector routes V2 records to the diagnostic writer', async () => {
	const candidate = measurement();
	let written: unknown = null;
	const collected = await collectM5bQualityCurrent('native-media', {
		measurementPath: '/diagnostics/native-media.json',
		workloadCommand: null,
		outputDirectory: '/unused',
	}, {
		config,
		processEnvironment: {},
		readMeasurement: async (path: string) => {
			assert.equal(path, '/diagnostics/native-media.json');
			return candidate;
		},
		writeV2Result: async (directory: string, profileId: string, raw: unknown, result: unknown) => {
			written = { directory, profileId, raw, result };
			return written;
		},
	});
	assert.equal(collected, written);
	assert.equal((written as { directory: string }).directory, '/unused');
});
