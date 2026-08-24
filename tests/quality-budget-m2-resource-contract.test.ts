import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);
const closureUrl = new URL('../config/milestone-2-closure.json', import.meta.url);

const ENVIRONMENT_ID = 'portable-node-structural-26.5.0';
const QUALIFIED_IDS = Object.freeze([
	'm2-streaming-project-8gib-v1',
	'm2-direct-wav-385mib-v1',
	'm2-direct-stem-archives-v3',
	'm2-direct-compressed-output-v2',
	'm2-direct-mp4-webm-video-output-v1',
]);

const EXPECTED_THRESHOLDS = new Map<string, readonly Readonly<Record<string, unknown>>[]>([
	['m2-streaming-project-8gib-v1', [
		{ metricId: 'streaming.maximumProtocolRangeBytes', comparison: 'lte', value: 16_777_216, unit: 'bytes' },
		{ metricId: 'streaming.maximumMediaEmissionBytes', comparison: 'lte', value: 4_194_304, unit: 'bytes' },
		{ metricId: 'streaming.retainedMediaPayloadBytes', comparison: 'eq', value: 0, unit: 'bytes' },
		{ metricId: 'streaming.invalidPublishedRevisions', comparison: 'eq', value: 0, unit: 'count' },
	]],
	['m2-direct-wav-385mib-v1', [
		{ metricId: 'directWav.maximumPathOwnedBinaryBytes', comparison: 'lte', value: 67_108_864, unit: 'bytes' },
		{ metricId: 'directWav.maximumDestinationWriteBytes', comparison: 'lte', value: 4_194_304, unit: 'bytes' },
		{ metricId: 'directWav.retainedOutputPayloadBytes', comparison: 'eq', value: 0, unit: 'bytes' },
		{ metricId: 'directWav.oversizePreflightBytesRead', comparison: 'eq', value: 0, unit: 'bytes' },
		{ metricId: 'directWav.partialPublishedOutputs', comparison: 'eq', value: 0, unit: 'count' },
	]],
	['m2-direct-stem-archives-v3', [
		{ metricId: 'directStems.maximumInputSliceBytes', comparison: 'lte', value: 65_536, unit: 'bytes' },
		{ metricId: 'directStems.maximumOwnedCompressedStemBytes', comparison: 'lte', value: 268_435_456, unit: 'bytes' },
		{ metricId: 'directStems.maximumOwnedEncodedStems', comparison: 'lte', value: 1, unit: 'count' },
		{ metricId: 'directStems.finalArchiveBlobBytes', comparison: 'eq', value: 0, unit: 'bytes' },
		{ metricId: 'directStems.partialPublishedOutputs', comparison: 'eq', value: 0, unit: 'count' },
	]],
	['m2-direct-compressed-output-v2', [
		{ metricId: 'directCompressed.maximumStagingBytes', comparison: 'lte', value: 268_435_456, unit: 'bytes' },
		{ metricId: 'directCompressed.maximumOutputRangeBytes', comparison: 'lte', value: 1_048_576, unit: 'bytes' },
		{ metricId: 'directCompressed.maximumConcurrentRangeReads', comparison: 'lte', value: 1, unit: 'count' },
		{ metricId: 'directCompressed.retainedFinalOutputBytes', comparison: 'eq', value: 0, unit: 'bytes' },
		{ metricId: 'directCompressed.partialPublishedOutputs', comparison: 'eq', value: 0, unit: 'count' },
	]],
	['m2-direct-mp4-webm-video-output-v1', [
		{ metricId: 'directVideo.maximumOutputRangeBytes', comparison: 'lte', value: 1_048_576, unit: 'bytes' },
		{ metricId: 'directVideo.maximumConcurrentRangeReads', comparison: 'lte', value: 1, unit: 'count' },
		{ metricId: 'directVideo.maximumConcurrentSinkWrites', comparison: 'lte', value: 1, unit: 'count' },
		{ metricId: 'directVideo.retainedFinalOutputBytes', comparison: 'eq', value: 0, unit: 'bytes' },
		{ metricId: 'directVideo.partialPublishedOutputs', comparison: 'eq', value: 0, unit: 'count' },
	]],
]);

test('the frozen milestone-2 resource IDs own exact structural workload contracts', async () => {
	const [budgets, closure] = await Promise.all([
		readFile(budgetsUrl, 'utf8').then(JSON.parse),
		readFile(closureUrl, 'utf8').then(JSON.parse),
	]);
	const item = closure.items.find(({ id }: { readonly id: string }) => id === 'm2-pipeline-resource-qualification');
	assert.deepEqual(item.workloadIds, [...EXPECTED_THRESHOLDS.keys()]);

	const workloads = new Map(budgets.workloads.map((workload: { readonly id: string }) => [workload.id, workload]));
	for (const [id, thresholds] of EXPECTED_THRESHOLDS) {
		const workload = workloads.get(id) as undefined | {
			readonly environmentIds: readonly string[];
			readonly evidence: readonly string[];
			readonly fixtureIds: readonly string[];
			readonly milestone: string;
			readonly status: string;
			readonly thresholds: readonly Readonly<Record<string, unknown>>[];
		};
		assert.ok(workload, id);
		assert.equal(workload.milestone, '2', id);
		assert.equal(workload.status, QUALIFIED_IDS.includes(id) ? 'qualified' : 'provisional', id);
		assert.deepEqual(workload.fixtureIds, [id], id);
		assert.deepEqual(workload.environmentIds, [ENVIRONMENT_ID], id);
		assert.deepEqual(workload.thresholds, thresholds, id);
		assert.ok(workload.evidence.length > 0, id);
		for (const reference of workload.evidence) {
			await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
		}
	}
});

test('reviewed no-retry cohorts cover the exact qualified workload set', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const qualifiedIds = [...QUALIFIED_IDS];
	assert.deepEqual(budgets.qualification.qualifiedWorkloadIds, qualifiedIds);
	assert.equal(budgets.qualification.acceptedResultCohorts.length, 2);
	const [historical, observed] = budgets.qualification.acceptedResultCohorts;
	assert.deepEqual([
		[historical.id, historical.sourceRevision, historical.budgetSha256],
		[observed.id, observed.sourceRevision, observed.budgetSha256],
	], [
		['m2-structural-aad0ba1', 'aad0ba1630d6c1a554da1ba5134307d274210f47', '9ebd33f88b5ce7af51a99175b48d6ddf19175b11f962c6f765d2825d59fdf7d1'],
		['m2-direct-observed-f3d11cb3', 'f3d11cb307a227fefb60cee5392b46e8919d9eb6', 'fe1efab919627fb70cfbc640ece9a8e898895f5b6da19188444f9c45ccf09a78'],
	]);
	assert.deepEqual(budgets.qualification.acceptedResultCohorts.flatMap(
		(cohort: { readonly artifacts: readonly { readonly workloadId: string }[] }) => (
			cohort.artifacts.map(({ workloadId }) => workloadId)
		),
	), qualifiedIds);
	for (const cohort of budgets.qualification.acceptedResultCohorts) {
		assert.equal(cohort.environmentId, ENVIRONMENT_ID);
		assert.equal(cohort.attemptCount, 1);
		assert.equal(cohort.retryCount, 0);
		assert.equal(cohort.retention, 'reviewed-workspace-artifacts-with-checked-in-byte-length-and-sha256');
		for (const artifact of cohort.artifacts) {
			assert.ok(Number.isSafeInteger(artifact.resultByteLength) && artifact.resultByteLength > 0);
			assert.ok(Number.isSafeInteger(artifact.rawByteLength) && artifact.rawByteLength > 0);
			assert.match(artifact.resultSha256, /^[a-f\d]{64}$/u);
			assert.match(artifact.rawSha256, /^[a-f\d]{64}$/u);
		}
	}
});

test('the structural Node environment is eligible only for the frozen workload set', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const environment = budgets.environments.find(({ id }: { readonly id: string }) => id === ENVIRONMENT_ID);

	assert.deepEqual(environment, {
		id: ENVIRONMENT_ID,
		status: 'active',
		kind: 'portable-deterministic-node-structural',
		qualificationEligible: true,
		rendererRequirement: 'any',
		eligibleWorkloadIds: [...EXPECTED_THRESHOLDS.keys()],
		fingerprint: {
			platform: 'linux',
			architecture: 'x64',
			nodeVersion: '26.5.0',
			npmVersion: '12.0.1',
			measurementClass: 'first-party-owned-structural-counters',
		},
		evidence: ['.nvmrc', 'package.json', 'package-lock.json', 'docs/quality-budgets.md#portable-structural-environment'],
	});
});
