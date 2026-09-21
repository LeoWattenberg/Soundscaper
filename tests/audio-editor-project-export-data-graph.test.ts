/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMatchingExportDataGraph } from '../src/common/editor/project-export-data-graph.ts';

for (const [canonicalProject, projectLabel] of [
	['canonical project', 'Soundscaper baseline'],
	['canonical retime project', 'retime export projection'],
] as const) {
	test(`${projectLabel} compares aliased cyclic data without invoking accessors`, () => {
		const first = { value: 1, next: null as unknown };
		const second = { value: 1, next: null as unknown };
		first.next = first;
		second.next = second;
		const left = { first, again: first, list: [first] };
		const right = { first: second, again: second, list: [second] };
		assert.doesNotThrow(() => assertMatchingExportDataGraph(left, right, projectLabel, canonicalProject));
		assert.throws(() => assertMatchingExportDataGraph(left, {
			...right, again: { value: 1, next: second },
		}, projectLabel, canonicalProject), new RegExp(`${projectLabel} has divergent object aliases\\.`));
		const accessor = Object.defineProperty({}, 'value', {
			enumerable: true,
			get() { throw new Error('the accessor must not run'); },
		});
		assert.throws(() => assertMatchingExportDataGraph(accessor, { value: 1 }, projectLabel,
			canonicalProject), new RegExp(`${projectLabel} must contain matching data properties\\.`));
	});

	test(`${projectLabel} enforces exact shapes and canonical wording`, () => {
		const diverges = new RegExp(`${projectLabel} diverges from its exact ${canonicalProject}\\.`);
		assert.throws(() => assertMatchingExportDataGraph(1, 2, projectLabel, canonicalProject), diverges);
		assert.throws(() => assertMatchingExportDataGraph([], {}, projectLabel, canonicalProject), diverges);
		assert.throws(() => assertMatchingExportDataGraph({ a: 1, b: 2 }, {
			b: 2, a: 1,
		}, projectLabel, canonicalProject), diverges);
		const symbol = Symbol('data');
		assert.doesNotThrow(() => assertMatchingExportDataGraph({ [symbol]: 5 }, { [symbol]: 5 },
			projectLabel, canonicalProject));
		assert.throws(() => assertMatchingExportDataGraph(
			Object.defineProperty({}, 'data', { value: 1, enumerable: false }),
			{ data: 1 }, projectLabel, canonicalProject,
		), new RegExp(`${projectLabel} must contain matching data properties\\.`));
	});
}
