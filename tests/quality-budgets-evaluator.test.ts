/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateQualityBudget } from '../scripts/quality-budget-evaluator.mjs';

const thresholds = [
	{ metricId: 'parity.omissions', behavior: 'blocking', comparison: 'eq', value: 0, unit: 'count' },
	{ metricId: 'preview.frameIntervalP95Ms', behavior: 'observational', comparison: 'lte', value: 33.34, unit: 'ms' },
] as const;

test('quality budget evaluator accepts exact boundaries without a configured host', () => {
	const evaluation = evaluateQualityBudget(thresholds, {
		'parity.omissions': 0,
		'preview.frameIntervalP95Ms': 33.34,
	});

	assert.equal(evaluation.passed, true);
	assert.deepEqual(evaluation.failures, []);
	assert.deepEqual(evaluation.warnings, []);
	assert.ok(evaluation.verdicts.every(({ passed }) => passed));
});

test('blocking misses fail while observational misses warn', () => {
	const warning = evaluateQualityBudget(thresholds, {
		'parity.omissions': 0,
		'preview.frameIntervalP95Ms': 50,
	});
	assert.equal(warning.passed, true);
	assert.equal(warning.failures.length, 0);
	assert.equal(warning.warnings.length, 1);

	const failure = evaluateQualityBudget(thresholds, {
		'parity.omissions': 1,
		'preview.frameIntervalP95Ms': 50,
	});
	assert.equal(failure.passed, false);
	assert.equal(failure.failures.length, 1);
	assert.equal(failure.warnings.length, 1);
});

test('quality budget evaluator refuses incomplete, extra, and non-finite measurements', () => {
	for (const metrics of [
		{ 'parity.omissions': 0 },
		{ 'parity.omissions': 0, 'preview.frameIntervalP95Ms': 20, extra: 1 },
		{ 'parity.omissions': Number.NaN, 'preview.frameIntervalP95Ms': 20 },
	]) {
		const evaluation = evaluateQualityBudget(thresholds, metrics);
		assert.equal(evaluation.passed, false);
	}
});
