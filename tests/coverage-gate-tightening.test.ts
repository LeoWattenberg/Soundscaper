/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import {
	COVERAGE_TIGHTEN_MARGIN,
	coverageMeasurementsFromAnalysis,
	describeCoverageFloorChange,
	tightenCoverageGates,
} from '../scripts/lib/coverage-gate-tightening.mjs';

interface CoverageScope {
	id: string;
	label: string;
	thresholds: { lines: number, branches: number, functions: number };
	reason: string;
}

type Measurements = Record<string, Record<string, number>>;

function configuration(): { schemaVersion: number, scopes: CoverageScope[] } {
	return {
		schemaVersion: 1,
		scopes: [
			{
				id: 'editor',
				label: 'Editor',
				thresholds: { lines: 80, branches: 70, functions: 80 },
				reason: 'The editor tree outside its controller, command and engine code.',
			},
			{
				id: 'editor-core',
				label: 'Editor core',
				thresholds: { lines: 90, branches: 80, functions: 95 },
				reason: 'The trees that decide what every edit does.',
			},
		],
	};
}

const measured: Measurements = {
	editor: { lines: 84.85, branches: 80.41, functions: 84.34 },
	'editor-core': { lines: 91.11, branches: 81.3, functions: 96.16 },
};

test('a floor follows the measurement up, one point behind it', () => {
	assert.equal(COVERAGE_TIGHTEN_MARGIN, 1);
	const { configuration: tightened, changes } = tightenCoverageGates(configuration(), measured);
	assert.deepEqual(tightened.scopes[0].thresholds, { lines: 83, branches: 79, functions: 83 });
	assert.deepEqual(tightened.scopes[1].thresholds, { lines: 90, branches: 80, functions: 95 });
	assert.deepEqual(changes.map(({ scope, metric }) => `${scope}.${metric}`), [
		'editor.lines',
		'editor.branches',
		'editor.functions',
	]);
	assert.deepEqual(changes[0], { scope: 'editor', metric: 'lines', measured: 84.85, from: 80, to: 83 });
	assert.equal(describeCoverageFloorChange(changes[0]), 'editor.lines: 80% -> 83% (measured 84.85%)');
});

test('the margin is the only headroom a raised floor keeps', () => {
	const { configuration: tightened } = tightenCoverageGates(configuration(), measured, { margin: 0 });
	assert.deepEqual(tightened.scopes[0].thresholds, { lines: 84, branches: 80, functions: 84 });
	assert.deepEqual(tightened.scopes[1].thresholds, { lines: 91, branches: 81, functions: 96 });
	assert.throws(() => tightenCoverageGates(configuration(), measured, { margin: -1 }), /margin/u);
});

test('a scope that lost coverage keeps the floor it earned', () => {
	const { configuration: tightened, changes } = tightenCoverageGates(configuration(), {
		editor: { lines: 12, branches: 0, functions: 79.99 },
		'editor-core': { lines: 90, branches: 80, functions: 95 },
	});
	assert.deepEqual(tightened.scopes.map(({ thresholds }) => thresholds),
		configuration().scopes.map(({ thresholds }) => thresholds));
	assert.deepEqual(changes, []);
});

test('tightening preserves the labels and the recorded reasons', () => {
	const { configuration: tightened } = tightenCoverageGates(configuration(), measured);
	assert.equal(tightened.schemaVersion, 1);
	assert.deepEqual(tightened.scopes.map(({ id, label, reason }) => ({ id, label, reason })),
		configuration().scopes.map(({ id, label, reason }) => ({ id, label, reason })));
});

test('a report that measures a scope the configuration does not budget is refused', () => {
	assert.throws(() => tightenCoverageGates(configuration(), {
		...measured,
		lightscaper: { lines: 100, branches: 100, functions: 100 },
	}), /unbudgeted scope: lightscaper/u);
});

test('a report missing a budgeted scope is refused rather than tightening the rest', () => {
	assert.throws(() => tightenCoverageGates(configuration(), { editor: measured.editor }),
		/measured no production files for scope editor-core/u);
	assert.throws(() => tightenCoverageGates(configuration(), {
		...measured,
		editor: { lines: 84.85, branches: 80.41 },
	}), /no valid functions percentage for scope editor/u);
	assert.throws(() => tightenCoverageGates(configuration(), null as never), /measured coverage/u);
	assert.throws(() => tightenCoverageGates({ scopes: [] }, measured), /must list the scopes/u);
});

test('an empty scope is left out of the measurements so the ratchet refuses the report', () => {
	const analysis = {
		scopes: [
			{ id: 'editor', files: 3, metrics: percentages(84.85, 80.41, 84.34) },
			{ id: 'editor-core', files: 0, metrics: percentages(100, 100, 100) },
		],
	};
	assert.deepEqual(coverageMeasurementsFromAnalysis(analysis), { editor: measured.editor });
	assert.throws(() => tightenCoverageGates(configuration(), coverageMeasurementsFromAnalysis(analysis)),
		/measured no production files for scope editor-core/u);
});

test('no measurement of any shape lowers a floor', () => {
	fc.assert(fc.property(
		fc.record({
			lines: fc.double({ min: 0, max: 100, noNaN: true }),
			branches: fc.double({ min: 0, max: 100, noNaN: true }),
			functions: fc.double({ min: 0, max: 100, noNaN: true }),
		}),
		fc.double({ min: 0, max: 100, noNaN: true }),
		(editor, margin) => {
			const before = configuration();
			const { configuration: after } = tightenCoverageGates(before, {
				editor,
				'editor-core': { lines: 0, branches: 0, functions: 0 },
			}, { margin });
			for (const [index, scope] of after.scopes.entries()) {
				for (const metric of ['lines', 'branches', 'functions'] as const) {
					assert.ok(scope.thresholds[metric] >= before.scopes[index].thresholds[metric]);
					assert.ok(scope.thresholds[metric] <= 100);
				}
			}
		},
	));
});

function percentages(lines: number, branches: number, functions: number) {
	return {
		lines: { covered: 0, total: 0, percentage: lines },
		branches: { covered: 0, total: 0, percentage: branches },
		functions: { covered: 0, total: 0, percentage: functions },
	};
}
