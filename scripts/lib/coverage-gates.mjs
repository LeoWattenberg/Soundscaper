/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export const COVERAGE_METRICS = Object.freeze(['lines', 'branches', 'functions']);

/**
 * The floors and the sentences that justify them live in
 * `config/coverage-gates.json`.
 *
 * They were literals in this module, which made every floor a source edit and
 * left no room to say why a scope is held where it is. A configuration file is
 * also what `scripts/tighten-coverage-gates.mjs` writes back to when a scope
 * has gained coverage and its floor can follow it up.
 */
export const COVERAGE_GATE_CONFIGURATION_URL = new URL(
	'../../config/coverage-gates.json',
	import.meta.url,
);

/**
 * The production trees, most specific first: the first matching prefix owns the
 * file. The editor's controller, command and engine trees are matched ahead of
 * the wider editor scope so that the code deciding what an edit does carries its
 * own branch floor instead of averaging into the tree it steers.
 */
const COVERAGE_SCOPE_PREFIXES = Object.freeze([
	Object.freeze(['src/common/editor/controller/', 'editor-core']),
	Object.freeze(['src/common/editor/commands/', 'editor-core']),
	Object.freeze(['src/common/editor/engine/', 'editor-core']),
	Object.freeze(['src/common/editor/', 'editor']),
	Object.freeze(['desktop/', 'desktop']),
	Object.freeze(['src/framescaper/', 'framescaper']),
	Object.freeze(['src/soundscaper/', 'soundscaper']),
	Object.freeze(['src/common/transfer/', 'common-transfer']),
	Object.freeze(['src/common/site/', 'common-site']),
	Object.freeze(['src/common/i18n/', 'common-i18n']),
	Object.freeze(['src/common/offline/', 'common-offline']),
	Object.freeze(['src/common/', 'shared-root']),
]);

export const COVERAGE_SCOPES = loadCoverageScopes(COVERAGE_GATE_CONFIGURATION_URL);

/**
 * @param {URL | string} configurationUrl
 * @returns {readonly { id: string, label: string, thresholds: Record<string, number>, reason: string }[]}
 */
export function loadCoverageScopes(configurationUrl) {
	return parseCoverageGateConfiguration(JSON.parse(readFileSync(configurationUrl, 'utf8')));
}

/**
 * Admitted strictly: a floor that cannot be read is a gate that enforces
 * nothing, and a scope the classifier never produces is a floor nobody applies.
 *
 * @param {unknown} configuration
 */
export function parseCoverageGateConfiguration(configuration) {
	const scopes = configuration?.scopes;
	if (!Array.isArray(scopes) || scopes.length === 0) {
		throw new TypeError('The coverage gate configuration must list the scopes the gate enforces.');
	}
	const parsed = scopes.map((scope) => coverageScope(scope));
	const budgeted = new Set(parsed.map(({ id }) => id));
	if (budgeted.size !== parsed.length) {
		throw new RangeError('The coverage gate configuration budgets a scope twice.');
	}
	const classified = new Set(COVERAGE_SCOPE_PREFIXES.map(([, id]) => id));
	for (const id of classified) {
		if (!budgeted.has(id)) throw new RangeError(`The coverage gate configuration has no floors for scope ${id}.`);
	}
	for (const { id } of parsed) {
		if (!classified.has(id)) throw new RangeError(`The coverage gate configuration budgets an unreachable scope: ${id}.`);
	}
	return Object.freeze(parsed);
}

export function classifyProductionCoveragePath(path) {
	const normalized = normalizePath(path);
	for (const [prefix, scopeId] of COVERAGE_SCOPE_PREFIXES) {
		if (normalized.startsWith(prefix)) return scopeId;
	}
	if (/^src\/[^/]+\.(?:[cm]?[jt]sx?)$/u.test(normalized)) return 'shared-root';
	return null;
}

export function analyzeCoverageSummary(summary, repositoryRoot) {
	const scopes = new Map(COVERAGE_SCOPES.map((scope) => [scope.id, emptyScopeSummary(scope)]));
	const unclassified = [];
	for (const [reportedPath, fileSummary] of Object.entries(summary)) {
		if (reportedPath === 'total') continue;
		const path = normalizePath(isAbsolute(reportedPath)
			? relative(repositoryRoot, reportedPath)
			: reportedPath);
		const scopeId = classifyProductionCoveragePath(path);
		if (scopeId === null) {
			unclassified.push(path);
			continue;
		}
		const scope = scopes.get(scopeId);
		scope.files += 1;
		for (const metric of COVERAGE_METRICS) {
			scope.metrics[metric].covered += numericCount(fileSummary, metric, 'covered', path);
			scope.metrics[metric].total += numericCount(fileSummary, metric, 'total', path);
		}
	}

	const failures = [];
	if (unclassified.length > 0) {
		failures.push(`Coverage reported unclassified production files: ${unclassified.sort().join(', ')}.`);
	}
	for (const scope of scopes.values()) {
		if (scope.files === 0) {
			failures.push(`${scope.label} coverage reported no production files.`);
			continue;
		}
		for (const metric of COVERAGE_METRICS) {
			const counts = scope.metrics[metric];
			counts.percentage = percentage(counts.covered, counts.total);
			const threshold = scope.thresholds[metric];
			if (counts.percentage < threshold) {
				failures.push(
					`${scope.label} ${metric} coverage is ${counts.percentage.toFixed(2)}% `
					+ `(${counts.covered}/${counts.total}), below the ${threshold}% threshold.`,
				);
			}
		}
	}
	return { scopes: [...scopes.values()], failures };
}

export function formatCoverageScopes(scopes) {
	const rows = ['Coverage by production scope:'];
	for (const scope of scopes) {
		rows.push([
			`  ${scope.label}:`,
			...COVERAGE_METRICS.map((metric) => {
				const counts = scope.metrics[metric];
				return `${metric} ${counts.percentage.toFixed(2)}% (${counts.covered}/${counts.total})`;
			}),
		].join(' '));
	}
	return `${rows.join('\n')}\n`;
}

function coverageScope(scope) {
	const { id, label, thresholds, reason } = scope ?? {};
	if (typeof id !== 'string' || id === '') throw new TypeError('Every coverage scope needs an id.');
	if (typeof label !== 'string' || label === '') throw new TypeError(`Coverage scope ${id} has no label.`);
	if (typeof reason !== 'string' || reason.trim() === '') {
		throw new TypeError(`Coverage scope ${id} records no reason for its floors.`);
	}
	const floors = {};
	for (const metric of COVERAGE_METRICS) {
		const floor = thresholds?.[metric];
		if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0 || floor > 100) {
			throw new TypeError(`Coverage scope ${id} has no valid ${metric} floor.`);
		}
		floors[metric] = floor;
	}
	return Object.freeze({ id, label, thresholds: Object.freeze(floors), reason });
}

function emptyScopeSummary({ id, label, thresholds }) {
	return {
		id,
		label,
		thresholds,
		files: 0,
		metrics: Object.fromEntries(COVERAGE_METRICS.map((metric) => [
			metric,
			{ covered: 0, total: 0, percentage: 100 },
		])),
	};
}

function normalizePath(path) {
	return path.split(sep).join('/').replaceAll('\\', '/').replace(/^\.\//u, '');
}

function numericCount(summary, metric, field, path) {
	const value = summary?.[metric]?.[field];
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`Coverage for ${path} has no valid ${metric}.${field} count.`);
	}
	return value;
}

function percentage(covered, total) {
	return total === 0 ? 100 : 100 * covered / total;
}
