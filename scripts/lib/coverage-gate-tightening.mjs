/* SPDX-License-Identifier: AGPL-3.0-only */

import { COVERAGE_METRICS } from './coverage-gates.mjs';

/**
 * The headroom a tightened floor keeps under the measurement it was set from,
 * in percentage points.
 *
 * Coverage moves a little with every commit that adds a line, so a floor set to
 * the measurement itself fails the next unrelated change. One point is enough
 * to absorb that drift without giving a regression anywhere to hide.
 */
export const COVERAGE_TIGHTEN_MARGIN = 1;

/**
 * Raise the floors to the coverage the scopes now have.
 *
 * Floors only ever go up. A scope that lost coverage keeps the floor it earned,
 * so the gate reports the loss instead of the ratchet quietly recording it, and
 * lowering a floor stays a deliberate edit with its reason written down in
 * `config/coverage-gates.json`.
 *
 * @param {{ schemaVersion?: number, scopes: { id: string, label: string, thresholds: Record<string, number>, reason: string }[] }} configuration
 * @param {Record<string, Record<string, number>>} measurements measured percentages per scope
 * @param {{ margin?: number }} [options]
 */
export function tightenCoverageGates(configuration, measurements, { margin = COVERAGE_TIGHTEN_MARGIN } = {}) {
	const scopes = configuration?.scopes;
	if (!Array.isArray(scopes) || scopes.length === 0) {
		throw new TypeError('The coverage gate configuration must list the scopes the gate enforces.');
	}
	if (!measurements || typeof measurements !== 'object') {
		throw new TypeError('Tightening coverage floors needs the measured coverage of a completed report.');
	}
	if (!Number.isFinite(margin) || margin < 0) {
		throw new RangeError(`A coverage tightening margin must be a non-negative number of points; received ${margin}.`);
	}

	const budgeted = new Set(scopes.map(({ id }) => id));
	for (const id of Object.keys(measurements)) {
		if (!budgeted.has(id)) throw new RangeError(`The coverage report measures an unbudgeted scope: ${id}.`);
	}

	const changes = [];
	const tightened = scopes.map((scope) => {
		const measured = measurements[scope.id];
		if (!measured || typeof measured !== 'object') {
			throw new RangeError(`The coverage report measured no production files for scope ${scope.id}.`);
		}
		const thresholds = { ...scope.thresholds };
		let raised = false;
		for (const metric of COVERAGE_METRICS) {
			const percentage = measured[metric];
			if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
				throw new RangeError(`The coverage report has no valid ${metric} percentage for scope ${scope.id}.`);
			}
			const candidate = Math.max(0, Math.floor(percentage - margin));
			if (candidate <= thresholds[metric]) continue;
			changes.push({ scope: scope.id, metric, measured: percentage, from: thresholds[metric], to: candidate });
			thresholds[metric] = candidate;
			raised = true;
		}
		return raised ? { ...scope, thresholds } : scope;
	});

	return { configuration: { ...configuration, scopes: tightened }, changes };
}

/**
 * The measured percentages of the scopes that reported production files.
 *
 * A scope that reported nothing is left out rather than reported as complete:
 * `analyzeCoverageSummary` leaves an empty scope at 100%, and a ratchet fed that
 * would pin a floor at 99% against a shard that never uploaded its profile.
 * Leaving it out makes `tightenCoverageGates` refuse the whole report.
 *
 * @param {{ scopes: { id: string, files: number, metrics: Record<string, { percentage: number }> }[] }} analysis
 * @returns {Record<string, Record<string, number>>}
 */
export function coverageMeasurementsFromAnalysis(analysis) {
	const measurements = {};
	for (const scope of analysis?.scopes ?? []) {
		if (scope.files === 0) continue;
		measurements[scope.id] = Object.fromEntries(COVERAGE_METRICS.map((metric) => [
			metric,
			scope.metrics[metric].percentage,
		]));
	}
	return measurements;
}

/**
 * @param {{ scope: string, metric: string, measured: number, from: number, to: number }} change
 */
export function describeCoverageFloorChange({ scope, metric, measured, from, to }) {
	return `${scope}.${metric}: ${from}% -> ${to}% (measured ${measured.toFixed(2)}%)`;
}
