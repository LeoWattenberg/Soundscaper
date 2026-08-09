/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	barStartBeat,
	surroundingBarBoundaries,
} from '../src/common/editor/musical-grid.ts';

const SIGNATURE_MAP = {
	events: [
		{ id: 'four-four', bar: 0, numerator: 4, denominator: 4 },
		{ id: 'seven-eight', bar: 2, numerator: 7, denominator: 8 },
	],
};

test('bar coordinates stay exact across bar-anchored signature changes', () => {
	assert.deepEqual(barStartBeat(-1, SIGNATURE_MAP), { num: -4, den: 1 });
	assert.deepEqual(barStartBeat(0, SIGNATURE_MAP), { num: 0, den: 1 });
	assert.deepEqual(barStartBeat(1, SIGNATURE_MAP), { num: 4, den: 1 });
	assert.deepEqual(barStartBeat(2, SIGNATURE_MAP), { num: 8, den: 1 });
	assert.deepEqual(barStartBeat(3, SIGNATURE_MAP), { num: 23, den: 2 });
	assert.deepEqual(barStartBeat(4, SIGNATURE_MAP), { num: 15, den: 1 });
});

test('bar lookup encloses exact beats on either side of a signature event', () => {
	assert.deepEqual(surroundingBarBoundaries({ num: 15, den: 2 }, SIGNATURE_MAP), {
		lowerBar: 1, lowerBeat: { num: 4, den: 1 },
		upperBar: 2, upperBeat: { num: 8, den: 1 },
	});
	assert.deepEqual(surroundingBarBoundaries({ num: 8, den: 1 }, SIGNATURE_MAP), {
		lowerBar: 2, lowerBeat: { num: 8, den: 1 },
		upperBar: 3, upperBeat: { num: 23, den: 2 },
	});
	assert.deepEqual(surroundingBarBoundaries({ num: -1, den: 1 }, SIGNATURE_MAP), {
		lowerBar: -1, lowerBeat: { num: -4, den: 1 },
		upperBar: 0, upperBeat: { num: 0, den: 1 },
	});
});

test('signature helpers reject ambiguous and invalid maps', () => {
	assert.throws(() => barStartBeat(0, { events: [] }), /signature map/iu);
	assert.throws(() => barStartBeat(0, {
		events: [{ bar: 1, numerator: 4, denominator: 4 }],
	}), /beginning at zero/iu);
	assert.throws(() => barStartBeat(0, {
		events: [{ bar: 0, numerator: 4, denominator: 3 }],
	}), /power-of-two/iu);
});

test('maximum-size signature maps resolve one boundary without quadratic rescans', () => {
	const map = { events: Array.from({ length: 4_096 }, (_, bar) => ({
		id: `signature-${String(bar)}`, bar, numerator: bar % 2 ? 7 : 4, denominator: bar % 2 ? 8 : 4,
	})) };
	const target = barStartBeat(4_095, map);
	const startedAt = performance.now();
	const boundaries = surroundingBarBoundaries(target, map);
	const elapsed = performance.now() - startedAt;
	assert.equal(boundaries.lowerBar, 4_095);
	assert.ok(elapsed < 750, `signature boundary lookup took ${String(Math.round(elapsed))} ms`);
});
