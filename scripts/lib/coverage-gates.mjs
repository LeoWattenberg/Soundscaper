/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, relative, sep } from 'node:path';

const COVERAGE_METRICS = Object.freeze(['lines', 'branches', 'functions']);

export const COVERAGE_SCOPES = Object.freeze([
	coverageScope('editor', 'Editor', { lines: 80, branches: 70, functions: 80 }),
	coverageScope('desktop', 'Desktop', { lines: 80, branches: 70, functions: 85 }),
	coverageScope('framescaper', 'Framescaper', { lines: 46, branches: 65, functions: 55 }),
	coverageScope('soundscaper', 'Soundscaper', { lines: 60, branches: 68, functions: 80 }),
	coverageScope('common-transfer', 'Common transfer', { lines: 90, branches: 80, functions: 90 }),
	coverageScope('common-site', 'Common site', { lines: 50, branches: 80, functions: 70 }),
	coverageScope('common-i18n', 'Common i18n', { lines: 95, branches: 75, functions: 85 }),
	coverageScope('common-offline', 'Common offline', { lines: 85, branches: 70, functions: 90 }),
	coverageScope('shared-root', 'Shared root', { lines: 85, branches: 85, functions: 80 }),
]);

export function classifyProductionCoveragePath(path) {
	const normalized = normalizePath(path);
	if (normalized.startsWith('src/common/editor/')) return 'editor';
	if (normalized.startsWith('desktop/')) return 'desktop';
	if (normalized.startsWith('src/framescaper/')) return 'framescaper';
	if (normalized.startsWith('src/soundscaper/')) return 'soundscaper';
	if (normalized.startsWith('src/common/transfer/')) return 'common-transfer';
	if (normalized.startsWith('src/common/site/')) return 'common-site';
	if (normalized.startsWith('src/common/i18n/')) return 'common-i18n';
	if (normalized.startsWith('src/common/offline/')) return 'common-offline';
	if (normalized.startsWith('src/common/')) return 'shared-root';
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

function coverageScope(id, label, thresholds) {
	return Object.freeze({ id, label, thresholds: Object.freeze(thresholds) });
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
