/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMotionExpression, diagnoseMotionExpression, assertParsedMotionExpression } from '../src/common/editor/motion-expression-parser.ts';

test('M08 closed expression parser retains typed vectors, precedence, conditionals and stable literal bindings', () => {
	const program = parseMotionExpression('time < 1 ? [Math.sin(time), value[1], 0] : reference("position") + valueAtTime("offset", time - 1)');
	assert.equal(program.ast.kind, 'conditional'); assert.deepEqual(program.referenceIds, ['offset', 'position']); assert.deepEqual(program.audioAssetIds, []);
	assert.equal(Object.isFrozen(program.ast), true); assert.doesNotThrow(() => assertParsedMotionExpression(program));
	assert.throws(() => assertParsedMotionExpression(JSON.parse(JSON.stringify(program))), /parsed|program/iu);
	const arithmetic = parseMotionExpression('1 + 2 * 3 ** 2'); assert.equal(arithmetic.ast.kind, 'binary');
	if (arithmetic.ast.kind !== 'binary') throw new Error('Expected arithmetic'); assert.equal(arithmetic.ast.operator, '+'); assert.equal(arithmetic.ast.right.kind, 'binary');
});

test('M08 parser refuses host access, arbitrary calls, mutation and dynamic reference discovery', () => {
	for (const source of ['window.location', 'globalThis', 'this', 'import("host")', 'fetch("remote")', 'value.constructor', 'value["constructor"]', '(()=>1)()', 'value = 1', 'new Date()', 'while(true){}', 'Math.random()', 'reference(value)', 'valueAtTime(value, time)', 'audioAmplitude(value)']) {
		assert.throws(() => parseMotionExpression(source), Error, source);
	}
});

test('M08 malformed expressions yield source diagnostics without erasing editable source', () => {
	const source = 'value +\n sin('; const result = diagnoseMotionExpression(source);
	assert.equal(result.program, null); assert.equal(result.diagnostic?.code, 'syntax'); assert.equal(result.diagnostic?.start, source.length);
	const valid = diagnoseMotionExpression('ease(time, 0, 1, 0, 100)'); assert.equal(valid.diagnostic, null); assert.ok(valid.program);
	assert.deepEqual(parseMotionExpression('audioAmplitude("retained-audio", time, 0.02)').audioAssetIds, ['retained-audio']);
});

test('M08 source, node and nesting admission bounds stop resource exhaustion before interpretation', () => {
	assert.throws(() => parseMotionExpression('1'.repeat(17000)), /source|length|bounded/iu);
	assert.throws(() => parseMotionExpression('1 + 2 + 3', { maximumNodes: 4 }), /budget/iu);
	assert.throws(() => parseMotionExpression(`${'('.repeat(80)}1${')'.repeat(80)}`), /depth|budget/iu);
	assert.throws(() => parseMotionExpression(Array.from({ length: 100 }, () => '1').join('+')), /depth|budget/iu);
	assert.throws(() => parseMotionExpression('1e999'), /finite/iu);
});

test('M08 canonical expression strings and comments remain inert data with explicit intrinsic arity', () => {
	const program = parseMotionExpression('/* author note */ reference("line\\u002eopacity") // retained binding\n + clamp(2, 0, 1)');
	assert.deepEqual(program.referenceIds, ['line.opacity']); assert.throws(() => parseMotionExpression('sin(1, 2)'), /argument/iu);
	assert.throws(() => parseMotionExpression('[1, 2, 3, 4, 5]'), /vector/iu); assert.throws(() => parseMotionExpression('1; 2'), /token|syntax/iu);
});
