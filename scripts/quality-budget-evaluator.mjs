/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Evaluate already-aggregated benchmark metrics against one checked-in budget.
 * Collection stays workload-specific; this module deliberately owns only the
 * fail-closed, deterministic comparison policy.
 *
 * @param {{
 *   environmentId: string,
 *   rendererRequirement: 'any' | 'hardware',
 *   thresholds: readonly {
 *     metricId: string,
 *     comparison: 'eq' | 'gte' | 'lte',
 *     value: number,
 *     unit: string,
 *   }[],
 * }} budget
 * @param {{
 *   id: string,
 *   status: 'active' | 'unprovisioned',
 * }} expectedEnvironment
 * @param {{
 *   environmentId: string,
 *   rendererClass: 'hardware' | 'software' | 'unknown',
 *   metrics: Readonly<Record<string, number>>,
 * }} measurement
 */
export function evaluateQualityBudget(budget, expectedEnvironment, measurement) {
	const failures = [];
	const verdicts = [];

	if (budget.environmentId !== expectedEnvironment.id) {
		failures.push(
			`Budget environment ${budget.environmentId} does not match descriptor ${expectedEnvironment.id}.`,
		);
	}
	if (expectedEnvironment.status !== 'active') {
		failures.push(`Environment ${expectedEnvironment.id} is ${expectedEnvironment.status}.`);
	}
	if (measurement.environmentId !== budget.environmentId) {
		failures.push(
			`Environment mismatch: expected ${budget.environmentId}, received ${measurement.environmentId}.`,
		);
	}
	if (budget.rendererRequirement === 'hardware' && measurement.rendererClass !== 'hardware') {
		failures.push(
			`A hardware renderer is required; received ${measurement.rendererClass || 'unknown'}.`,
		);
	}

	for (const threshold of budget.thresholds) {
		if (!Object.hasOwn(measurement.metrics, threshold.metricId)) {
			failures.push(`Missing metric ${threshold.metricId}.`);
			verdicts.push(Object.freeze({
				metricId: threshold.metricId,
				actual: null,
				expected: threshold.value,
				comparison: threshold.comparison,
				unit: threshold.unit,
				passed: false,
			}));
			continue;
		}

		const actual = measurement.metrics[threshold.metricId];
		if (!Number.isFinite(actual)) {
			failures.push(`Metric ${threshold.metricId} must be finite; received ${String(actual)}.`);
			verdicts.push(Object.freeze({
				metricId: threshold.metricId,
				actual,
				expected: threshold.value,
				comparison: threshold.comparison,
				unit: threshold.unit,
				passed: false,
			}));
			continue;
		}

		const passed = compare(actual, threshold.comparison, threshold.value);
		if (!passed) {
			failures.push(
				`Metric ${threshold.metricId} was ${actual} ${threshold.unit}; expected ${threshold.comparison} ${threshold.value} ${threshold.unit}.`,
			);
		}
		verdicts.push(Object.freeze({
			metricId: threshold.metricId,
			actual,
			expected: threshold.value,
			comparison: threshold.comparison,
			unit: threshold.unit,
			passed,
		}));
	}

	return Object.freeze({
		passed: failures.length === 0,
		failures: Object.freeze(failures),
		verdicts: Object.freeze(verdicts),
	});
}

function compare(actual, comparison, expected) {
	if (comparison === 'eq') return actual === expected;
	if (comparison === 'gte') return actual >= expected;
	if (comparison === 'lte') return actual <= expected;
	return false;
}
