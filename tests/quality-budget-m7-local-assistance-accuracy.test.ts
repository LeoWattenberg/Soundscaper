/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface BudgetThreshold {
	readonly comparison: 'eq' | 'gte' | 'lte';
	readonly metricId: string;
	readonly unit: string;
	readonly value: number;
}

interface BudgetFixture {
	readonly id: string;
	readonly kind: string;
	readonly limitation?: string;
	readonly status: string;
}

interface BudgetWorkload {
	readonly environmentIds: readonly string[];
	readonly fixtureIds: readonly string[];
	readonly id: string;
	readonly status: string;
	readonly thresholds: readonly BudgetThreshold[];
}

interface QualityBudgetConfig {
	readonly fixtures: readonly BudgetFixture[];
	readonly qualification: Readonly<{
		acceptedResultCohorts: readonly Readonly<Record<string, unknown>>[];
		qualifiedWorkloadIds: readonly string[];
	}>;
	readonly workloads: readonly BudgetWorkload[];
}

const configUrl = new URL('../config/quality-budgets.json', import.meta.url);

test('milestone 7 registers what each assistance route owes rather than leaving it in prose', async () => {
	const config = JSON.parse(await readFile(configUrl, 'utf8')) as QualityBudgetConfig;
	const speech = config.workloads.find(({ id }) => id === 'm7-local-assistance-speech-accuracy');
	const visual = config.workloads.find(({ id }) => id === 'm7-local-assistance-visual-accuracy');

	assert.deepEqual(speech?.fixtureIds, ['m7-local-assistance-speech-accuracy-v1']);
	assert.deepEqual(visual?.fixtureIds, ['m7-local-assistance-visual-accuracy-v1']);
	assert.deepEqual(speech?.thresholds, [
		{ metricId: 'assistance.transcriptWordErrorRateRatio', comparison: 'lte', value: 0.15, unit: 'ratio' },
		{ metricId: 'assistance.transcriptWordTimingMedianErrorMs', comparison: 'lte', value: 120, unit: 'ms' },
		{ metricId: 'assistance.fillerProposalPrecisionRatio', comparison: 'gte', value: 0.9, unit: 'ratio' },
		{ metricId: 'assistance.fillerProposalRecallRatio', comparison: 'gte', value: 0.7, unit: 'ratio' },
		{ metricId: 'assistance.diarizationErrorRateRatio', comparison: 'lte', value: 0.2, unit: 'ratio' },
		{ metricId: 'assistance.diarizationLabelDrifts', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'assistance.transcriptSearchRecallAtFiveRatio', comparison: 'gte', value: 0.8, unit: 'ratio' },
		{ metricId: 'assistance.transcriptIndexRebuildDivergences', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'assistance.beatGridMedianErrorMs', comparison: 'lte', value: 40, unit: 'ms' },
		{ metricId: 'assistance.downbeatFMeasureRatio', comparison: 'gte', value: 0.8, unit: 'ratio' },
	]);
	assert.deepEqual(visual?.thresholds, [
		{ metricId: 'assistance.accurateShotBoundaryFMeasureRatio', comparison: 'gte', value: 0.9, unit: 'ratio' },
		{ metricId: 'assistance.fastShotBoundaryFMeasureRatio', comparison: 'gte', value: 0.7, unit: 'ratio' },
		{ metricId: 'assistance.visualRetrievalHitRateRatio', comparison: 'gte', value: 0.8, unit: 'ratio' },
		{ metricId: 'assistance.visualIndexBytesPerVideoHour', comparison: 'lte', value: 67_108_864, unit: 'bytes' },
		{ metricId: 'assistance.subjectRetentionRatio', comparison: 'gte', value: 0.9, unit: 'ratio' },
		{ metricId: 'assistance.reframeDegenerateFallbackFailures', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'assistance.highlightAssemblyRtf', comparison: 'lte', value: 0.5, unit: 'RTF' },
		{ metricId: 'assistance.highlightProposalDivergences', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'assistance.verticalCropGoldenFrameMismatches', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'assistance.unchangedExportByteDivergences', comparison: 'eq', value: 0, unit: 'count' },
	]);

	// A registered criterion states what a route owes; it is never evidence that
	// the route meets it, so neither workload may drift into the qualified set.
	for (const workload of [speech, visual]) {
		assert.equal(workload?.status, 'planned');
		assert.deepEqual(workload?.environmentIds, ['owner-qualified-windows-x64-rtx3090-01']);
		assert.equal(config.qualification.qualifiedWorkloadIds.includes(workload?.id ?? ''), false);
	}
	assert.equal(JSON.stringify(config.qualification.acceptedResultCohorts)
		.includes('m7-local-assistance'), false);

	const fixtures = new Map(config.fixtures.map((fixture) => [fixture.id, fixture]));
	for (const fixtureId of ['m7-local-assistance-speech-accuracy-v1', 'm7-local-assistance-visual-accuracy-v1']) {
		const fixture = fixtures.get(fixtureId);
		assert.equal(fixture?.status, 'planned');
		assert.equal(fixture?.kind, 'planned-offline-model-accuracy-corpus');
		assert.match(fixture?.limitation ?? '', /specified, not provisioned/u);
	}
});

