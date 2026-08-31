/* SPDX-License-Identifier: AGPL-3.0-only */

/** Evaluate one complete metric record against explicit blocking/observational thresholds. */
export function evaluateQualityBudget(thresholdsValue, metricsValue) {
	if (!Array.isArray(thresholdsValue) || thresholdsValue.length === 0) {
		throw new Error('Quality evaluation requires at least one threshold.');
	}
	if (!isRecord(metricsValue)) throw new Error('Quality evaluation metrics must be a plain record.');
	const failures = [];
	const warnings = [];
	const verdicts = [];
	const expectedIds = thresholdsValue.map(({ metricId }) => metricId).toSorted();
	const actualIds = Object.keys(metricsValue).toSorted();
	if (!sameStrings(actualIds, expectedIds)) {
		failures.push('Quality diagnostic metrics must contain the workload\'s exact measurement set.');
	}
	for (const thresholdValue of thresholdsValue) {
		const threshold = requireThreshold(thresholdValue);
		const actual = metricsValue[threshold.metricId];
		let passed = typeof actual === 'number' && Number.isFinite(actual);
		if (passed) passed = compare(actual, threshold.comparison, threshold.value);
		verdicts.push(Object.freeze({
			metricId: threshold.metricId,
			behavior: threshold.behavior,
			comparison: threshold.comparison,
			expected: threshold.value,
			actual: typeof actual === 'number' && Number.isFinite(actual) ? actual : null,
			unit: threshold.unit,
			passed,
		}));
		if (passed) continue;
		const message = actual === undefined
			? `Missing measurement ${threshold.metricId}.`
			: typeof actual !== 'number' || !Number.isFinite(actual)
				? `Measurement ${threshold.metricId} must be finite.`
				: `Measurement ${threshold.metricId} was ${String(actual)} ${threshold.unit}; expected ${threshold.comparison} ${String(threshold.value)} ${threshold.unit}.`;
		if (threshold.behavior === 'blocking') failures.push(message);
		else warnings.push(message);
	}
	return Object.freeze({
		passed: failures.length === 0,
		failures: Object.freeze(failures),
		warnings: Object.freeze(warnings),
		verdicts: Object.freeze(verdicts),
	});
}

function requireThreshold(value) {
	if (!isRecord(value)
		|| typeof value.metricId !== 'string'
		|| !['blocking', 'observational'].includes(value.behavior)
		|| !['eq', 'gte', 'lte'].includes(value.comparison)
		|| typeof value.value !== 'number'
		|| !Number.isFinite(value.value)
		|| typeof value.unit !== 'string'
		|| value.unit.length === 0) {
		throw new Error('Quality threshold is invalid.');
	}
	return value;
}

function compare(actual, comparison, expected) {
	if (comparison === 'eq') return actual === expected;
	if (comparison === 'gte') return actual >= expected;
	return actual <= expected;
}

function sameStrings(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
