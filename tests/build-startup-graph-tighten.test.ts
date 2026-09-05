/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	STARTUP_GRAPH_TIGHTENED_METRICS,
	tightenStartupGraphBudgets,
} from '../scripts/tighten-startup-graph.mjs';

interface BudgetGraph {
	ceilings: Record<string, number>;
	reasons: Record<string, string>;
}

function configuration(): Record<string, BudgetGraph> {
	return {
		initial: {
			ceilings: { requests: 10, modulepreloads: 6, cssFiles: 2, rawBytes: 350_000, brotliBytes: 100_000 },
			reasons: {},
		},
		framescaper: {
			ceilings: { requests: 84, rawBytes: 7_000_000, brotliBytes: 1_650_000 },
			reasons: { requests: 'Raised because splitting adds chunks by construction.' },
		},
	};
}

const report = Object.freeze({
	product: 'framescaper',
	graphs: {
		initial: { requests: 8, rawBytes: 300_000, brotliBytes: 90_000 },
		framescaper: { requests: 70, rawBytes: 6_400_000, brotliBytes: 1_500_000 },
	},
});

test('only the byte ceilings ratchet down, to the measured graph plus five per cent', () => {
	assert.deepEqual([...STARTUP_GRAPH_TIGHTENED_METRICS].sort(), ['brotliBytes', 'rawBytes']);
	const { configuration: tightened, changes } = tightenStartupGraphBudgets(configuration(), report);
	assert.deepEqual(tightened.framescaper.ceilings, {
		requests: 84,
		rawBytes: 6_720_000,
		brotliBytes: 1_575_000,
	});
	assert.deepEqual(tightened.initial.ceilings, {
		requests: 10,
		modulepreloads: 6,
		cssFiles: 2,
		rawBytes: 315_000,
		brotliBytes: 94_500,
	});
	assert.deepEqual(changes.map(({ graph, metric }) => `${graph}.${metric}`).sort(), [
		'framescaper.brotliBytes',
		'framescaper.rawBytes',
		'initial.brotliBytes',
		'initial.rawBytes',
	]);
	assert.deepEqual(changes.find(({ graph, metric }) => graph === 'framescaper' && metric === 'rawBytes'), {
		graph: 'framescaper',
		metric: 'rawBytes',
		observed: 6_400_000,
		from: 7_000_000,
		to: 6_720_000,
	});
});

test('a request ceiling is never touched even when the measured graph is far below it', () => {
	const { configuration: tightened } = tightenStartupGraphBudgets(configuration(), {
		product: 'framescaper',
		graphs: { framescaper: { requests: 3, rawBytes: 7_000_000, brotliBytes: 1_650_000 } },
	});
	assert.equal(tightened.framescaper.ceilings.requests, 84);
	assert.equal(tightened.initial.ceilings.modulepreloads, 6);
	assert.equal(tightened.initial.ceilings.cssFiles, 2);
});

test('a ceiling is never raised, and a rounded-up measurement above it leaves it alone', () => {
	const grown = {
		product: 'framescaper',
		graphs: { framescaper: { requests: 84, rawBytes: 6_999_999, brotliBytes: 1_700_000 } },
	};
	const { configuration: tightened, changes } = tightenStartupGraphBudgets(configuration(), grown);
	assert.deepEqual(tightened.framescaper.ceilings, configuration().framescaper.ceilings);
	assert.deepEqual(changes, []);
});

test('tightening preserves the recorded reasons and every unmeasured graph', () => {
	const { configuration: tightened, changes } = tightenStartupGraphBudgets(configuration(), {
		product: 'framescaper',
		graphs: { framescaper: { requests: 70, rawBytes: 6_400_000, brotliBytes: 1_500_000 } },
	});
	assert.deepEqual(tightened.framescaper.reasons, configuration().framescaper.reasons);
	assert.deepEqual(tightened.initial, configuration().initial);
	assert.deepEqual(changes.map(({ graph }) => graph), ['framescaper', 'framescaper']);
});

test('a report without measured graphs is refused rather than silently tightening nothing', () => {
	assert.throws(() => tightenStartupGraphBudgets(configuration(), { product: 'framescaper', graphs: {} }),
		/no measured startup graphs/iu);
	assert.throws(() => tightenStartupGraphBudgets(configuration(), null as never), /startup graph report/iu);
});

test('a measured graph the configuration does not budget is refused', () => {
	assert.throws(() => tightenStartupGraphBudgets(configuration(), {
		product: 'lightscaper',
		graphs: { lightscaper: { requests: 4, rawBytes: 10, brotliBytes: 10 } },
	}), /lightscaper/u);
});
