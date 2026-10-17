/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleMotionAeNumericProperty } from '../src/common/editor/motion-ae-host-sampling.ts';
import type { MotionAeProperty, MotionAeReportEntry } from '../src/common/editor/motion-ae-exchange-types.ts';
import { normalizeMotionAeProperties } from '../src/common/editor/motion-ae-property-custody.ts';

const original: Extract<MotionAeProperty, { kind: 'numeric' }> = { kind: 'numeric', name: 'Position', matchName: 'ADBE Position', spatial: true,
	value: [0, 0], keys: [], expression: { source: '[time * 2, time * time]', enabled: true, disposition: 'unsupported' } };
test('explicit AE sampling retains authored expression and keys beside bounded frame-grid values', () => {
	const calls: number[] = [], report: MotionAeReportEntry[] = [{ scopeId: 'layer', propertyPath: '0:ADBE Position', status: 'unsupported', code: 'expression', message: 'Inert original' }];
	const value = sampleMotionAeNumericProperty(original, { valueAtTime: (time, preExpression) => {
		assert.equal(preExpression, false); calls.push(time); return [time * 2, time * time];
	} }, { frameRate: 4, duration: 1 }, () => {}, 'layer', '0:ADBE Position', report, { properties: 1, keys: 0 });
	assert.deepEqual(calls, [0, 0.25, 0.5, 0.75, 1]); assert.equal(value.keys, original.keys);
	assert.equal(value.expression?.source, original.expression?.source); assert.equal(value.expression?.disposition, 'sampled');
	assert.deepEqual(value.samples?.values, [[0, 0], [0.5, 0.0625], [1, 0.25], [1.5, 0.5625], [2, 1]]);
	assert.equal(original.expression?.disposition, 'unsupported'); assert.equal(report.filter((entry) => entry.code === 'expression').length, 1);
	assert.equal(report[0]?.status, 'sampled'); assert.match(report[0]!.message, /subframe/iu);
	assert.deepEqual(normalizeMotionAeProperties([value], { properties: 0, keys: 0 })[0], value);
});
test('AE sampling refuses allocation budgets before evaluation and cooperatively stops between native calls', () => {
	let calls = 0;
	const source = { valueAtTime: () => { calls++; return [1, 2]; } };
	assert.throws(() => sampleMotionAeNumericProperty(original, source, { frameRate: 60, duration: 100 }, () => {}, 'layer', 'p', [], { properties: 0, keys: 0 }), /budget/u);
	assert.throws(() => sampleMotionAeNumericProperty(original, source, { frameRate: 30, duration: 1 }, () => {}, 'layer', 'p', [], { properties: 0, keys: 262_140 }), /budget/u);
	assert.equal(calls, 0);
	assert.throws(() => sampleMotionAeNumericProperty(original, source, { frameRate: 4, duration: 1 }, () => { if (calls === 2) throw new Error('cancelled'); }, 'layer', 'p', [], { properties: 0, keys: 0 }), /cancelled/u);
	assert.equal(calls, 2);
});
test('AE sample custody rejects mismatched dimensions, nonfinite results and forged grids', () => {
	assert.throws(() => sampleMotionAeNumericProperty(original, { valueAtTime: () => [1] }, { frameRate: 4, duration: 1 }, () => {}, 'layer', 'p', [], { properties: 0, keys: 0 }), /dimension/u);
	assert.throws(() => sampleMotionAeNumericProperty(original, { valueAtTime: () => [NaN, 2] }, { frameRate: 4, duration: 1 }, () => {}, 'layer', 'p', [], { properties: 0, keys: 0 }), /finite/u);
	for (const samples of [{ frameRate: 0, firstFrame: 0, values: [[0, 0]] }, { frameRate: 24, firstFrame: -1, values: [[0, 0]] }, { frameRate: 24, firstFrame: 0, values: [[0]] }]) {
		assert.throws(() => normalizeMotionAeProperties([{ ...original, samples }], { properties: 0, keys: 0 }));
	}
});
