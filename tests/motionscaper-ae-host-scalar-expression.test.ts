/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readMotionAeHostScalarExpression } from '../src/common/editor/motion-ae-host-scalar-expression.ts';
import { translateMotionAeScalarExpression } from '../src/common/editor/motion-ae-expression-conversion.ts';

test('installed-side scalar admission accepts only the closed canonical translation grammar', () => {
	for (const source of ['value + sin(time*pi)*.25', 'value ** 2 + time', 'time < 1 ? min(value,.5) : max(value,.2)', '(time >= 0 && time < 1) ? value : abs(value-.5)']) {
		for (const scale of [.01, 1, 100]) {
			const result = translateMotionAeScalarExpression(source, { direction: 'to-after-effects', scale });
			assert.ok(result.source); assert.equal(readMotionAeHostScalarExpression(result.source), result.source);
		}
	}
	assert.equal(readMotionAeHostScalarExpression(' (value + Math.sin(time)) '), '(value + Math.sin(time))');
});

test('translated custody labels cannot admit malicious, stateful, nonfinite or coerced host expressions', () => {
	for (const source of [
		'value; app.project.close()', 'value++', '(value=2)', 'Math.random()', 'Math.sin.constructor("return app")()',
		'Math["sin"](time)', 'Math.PI()', '(time,true)', '1e999', '01', 'true', '"1"', '[1,2]', 'value[0]', '(true+1)',
		'(time===true)', '(time||false)', '(time?1:false)', 'Math.min(true,1)', 'Math.sin(1,2)', 'Math.pow(1)',
		'((time < 1) ? 1 : globalThis)', 'Math.sin.call(null,time)', 'value + time', 'value/*x*/', 'value;',
	]) assert.throws(() => readMotionAeHostScalarExpression(source), /scalar expression/u, source);
});

test('host scalar admission bounds text, parse nodes and nesting before returning source', () => {
	for (const source of [null, 1, {}, ' '.repeat(16_385), `${'('.repeat(65)}1${')'.repeat(65)}`]) assert.throws(() => readMotionAeHostScalarExpression(source), /scalar expression/u);
	let source = '1'; for (let i = 0; i < 11; i++) source = `(${source}+${source})`;
	assert.ok(source.length < 16_384);
	assert.throws(() => readMotionAeHostScalarExpression(source), /scalar expression/u);
});
