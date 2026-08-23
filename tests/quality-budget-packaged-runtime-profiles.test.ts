/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface QualificationEnvironment {
	readonly eligibleWorkloadIds: readonly string[];
	readonly fingerprint: Readonly<Record<string, string | number | null>>;
	readonly id: string;
	readonly qualificationEligible: boolean;
	readonly rendererRequirement: string;
	readonly status: string;
}

interface QualificationProfile {
	readonly diagnosticKey: string;
	readonly diagnosticIdentityFields?: readonly string[];
	readonly environmentId: string;
	readonly fingerprint?: Readonly<Record<string, string | number | null>>;
	readonly fixture?: Readonly<Record<string, unknown>>;
	readonly observationClass?: string;
	readonly observedEnvironmentId?: string;
	readonly profile?: string;
	readonly rawSampleCounts?: Readonly<Record<string, number>>;
	readonly status: string;
	readonly workloadId: string;
}

interface QualificationConfig {
	readonly environments: readonly QualificationEnvironment[];
	readonly packagedRuntimeQualification: Readonly<{
		readonly profiles: readonly QualificationProfile[];
		readonly status: string;
	}>;
}

test('packaged-runtime profiles admit only the owner-designated host workloads', async () => {
	const config = JSON.parse(await readFile(
		new URL('../config/quality-budgets.json', import.meta.url),
		'utf8',
	)) as QualificationConfig;
	const gpuEnvironment = config.environments.find(
		({ id }) => id === 'owner-qualified-windows-x64-rtx3090-01',
	);

	assert.equal(gpuEnvironment?.status, 'active');
	assert.equal(gpuEnvironment?.qualificationEligible, true);
	assert.equal(gpuEnvironment?.rendererRequirement, 'hardware');
	assert.ok(Object.values(gpuEnvironment?.fingerprint ?? {}).every((value) => value !== null));
	assert.deepEqual(gpuEnvironment?.eligibleWorkloadIds, [
		'm1-video-preview-12fx-720p',
		'm3-longform-editorial',
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
	assert.equal(config.packagedRuntimeQualification.status, 'active');
	const m1 = config.packagedRuntimeQualification.profiles[0];
	assert.equal(m1.observedEnvironmentId, 'packaged-runtime-win32-x64');
	assert.equal(m1.profile, 'deterministic-video-preview-12fx-v2');
	assert.equal(m1.observationClass, 'fresh-context-presentation-cadence-and-retained-js-heap-v1');
	assert.deepEqual(m1.diagnosticIdentityFields, [
		'workloadId', 'fixtureId', 'profile', 'observationClass',
	]);
	assert.deepEqual(m1.fingerprint, gpuEnvironment?.fingerprint);
	assert.equal(m1.fixture?.sourceSha256, 'f1319d3549943c190e5eb3f86b63fd2afb644bd49b32e3f257699b450271bc8c');
	assert.deepEqual(m1.rawSampleCounts, {
		warmupTrials: 1,
		measuredTrials: 5,
		measuredFrames: 605,
		measuredIntervals: 600,
		forcedCollectionsBefore: 15,
		forcedCollectionsAfter: 15,
		heapSnapshotsBefore: 5,
		heapSnapshotsAfter: 5,
	});
	assert.deepEqual(
		config.packagedRuntimeQualification.profiles.map(
			({ diagnosticKey, environmentId, status, workloadId }) => ({
				diagnosticKey, environmentId, status, workloadId,
			}),
		),
		[
			{
				diagnosticKey: 'm1-video-preview-12fx-720p',
				environmentId: 'owner-qualified-windows-x64-rtx3090-01',
				status: 'active',
				workloadId: 'm1-video-preview-12fx-720p',
			},
			{
				diagnosticKey: 'm3-longform-editorial',
				environmentId: 'owner-qualified-windows-x64-rtx3090-01',
				status: 'active',
				workloadId: 'm3-longform-editorial',
			},
			{
				diagnosticKey: 'm4-production-parity',
				environmentId: 'owner-qualified-windows-x64-rtx3090-01',
				status: 'active',
				workloadId: 'm4-production-render-parity',
			},
			{
				diagnosticKey: 'm4b2-keyframe-render-parity',
				environmentId: 'owner-qualified-windows-x64-rtx3090-01',
				status: 'active',
				workloadId: 'm4b2-keyframe-render-parity',
			},
		],
	);
});
