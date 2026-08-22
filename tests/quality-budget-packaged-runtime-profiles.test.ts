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
	readonly environmentId: string;
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
