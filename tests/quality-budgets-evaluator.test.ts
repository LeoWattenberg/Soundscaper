import assert from 'node:assert/strict';
import test from 'node:test';

import {
	evaluateQualityBudget,
} from '../scripts/quality-budget-evaluator.mjs';

/**
 * The evaluator decides whether one measured environment satisfies one budget.
 * Its cases live apart from the contract the configuration has to satisfy,
 * which is what the sibling file checks; keeping both in one unit took that
 * file past the maintainability ceiling.
 */
test('quality budget evaluator accepts exact boundaries on an active environment', () => {
	const evaluation = evaluateQualityBudget(
		{
			environmentId: 'fixed-gpu',
			rendererRequirement: 'hardware',
			thresholds: [
				{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34, unit: 'ms' },
				{ metricId: 'preview.ssimMinimum', comparison: 'gte', value: 0.98, unit: 'ratio' },
				{ metricId: 'preview.omissions', comparison: 'eq', value: 0, unit: 'count' },
			],
		},
		{ id: 'fixed-gpu', status: 'active' },
		{
			environmentId: 'fixed-gpu',
			rendererClass: 'hardware',
			metrics: {
				'preview.frameIntervalP95Ms': 33.34,
				'preview.ssimMinimum': 0.98,
				'preview.omissions': 0,
			},
		},
	);

	assert.equal(evaluation.passed, true);
	assert.deepEqual(evaluation.failures, []);
	assert.ok(evaluation.verdicts.every(({ passed }: { readonly passed: boolean }) => passed));
});

test('quality budget evaluator fails closed on missing metrics, environment mismatch, and software rendering', () => {
	const evaluation = evaluateQualityBudget(
		{
			environmentId: 'fixed-gpu',
			rendererRequirement: 'hardware',
			thresholds: [
				{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34, unit: 'ms' },
				{ metricId: 'preview.heapDeltaBytes', comparison: 'lte', value: 1_048_576, unit: 'bytes' },
			],
		},
		{ id: 'fixed-gpu', status: 'active' },
		{
			environmentId: 'another-host',
			rendererClass: 'software',
			metrics: { 'preview.frameIntervalP95Ms': Number.NaN },
		},
	);

	assert.equal(evaluation.passed, false);
	assert.ok(evaluation.failures.some((failure: string) => /environment mismatch/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /hardware renderer/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /finite/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /missing metric.*heapDeltaBytes/iu.test(failure)));
});

test('quality budget evaluator cannot use an unprovisioned environment', () => {
	const evaluation = evaluateQualityBudget(
		{
			environmentId: 'unprovisioned-gpu',
			rendererRequirement: 'hardware',
			thresholds: [{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34, unit: 'ms' }],
		},
		{ id: 'unprovisioned-gpu', status: 'unprovisioned' },
		{
			environmentId: 'unprovisioned-gpu',
			rendererClass: 'hardware',
			metrics: { 'preview.frameIntervalP95Ms': 10 },
		},
	);

	assert.equal(evaluation.passed, false);
	assert.ok(evaluation.failures.some((failure: string) => /unprovisioned/iu.test(failure)));
});
