import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { workloadThresholds } from '../scripts/lib/quality-budget-config.mjs';

const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);
const closureUrl = new URL('../config/milestone-2-closure.json', import.meta.url);

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
	const item = closure.items.find(({ id }: { readonly id: string }) => id === 'm2-pipeline-resource-verification');
	assert.deepEqual(item.workloadIds, [...EXPECTED_THRESHOLDS.keys()]);

	const workloads = new Map(budgets.workloads.map((workload: { readonly id: string }) => [workload.id, workload]));
	for (const [id, thresholds] of EXPECTED_THRESHOLDS) {
		const workload = workloads.get(id) as undefined | {
			readonly behavior: string;
			readonly fixtureIds: readonly string[];
			readonly measurementIds: readonly string[];
		};
		assert.ok(workload, id);
		assert.equal(workload.behavior, 'blocking', id);
		assert.deepEqual(workload.fixtureIds, [id], id);
		assert.deepEqual(
			workloadThresholds(budgets, id).map((threshold: Readonly<Record<string, unknown>>) => ({
				metricId: threshold.metricId,
				comparison: threshold.comparison,
				value: threshold.value,
				unit: threshold.unit,
			})),
			thresholds,
			id,
		);
	}
});

test('structural diagnostics record runtime identity in results rather than config', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	assert.equal(Object.hasOwn(budgets, 'environments'), false);
	assert.doesNotMatch(JSON.stringify(budgets), /portable-node-structural-26\.5\.0/u);
});
