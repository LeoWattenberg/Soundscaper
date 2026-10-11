/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMotionExpression } from '../src/common/editor/motion-expression-parser.ts';
import { evaluateMotionExpression, createMotionExpressionBudget, type MotionExpressionContext } from '../src/common/editor/motion-expression-evaluator.ts';
const context: MotionExpressionContext = { time: 2, localTime: 1, frame: 30, frameRate: 30, value: [10, 20, 30], index: 1, seed: 'composition/layer/position' };
const evaluate = (source: string, override: Partial<MotionExpressionContext> = {}) => evaluateMotionExpression(parseMotionExpression(source), { ...context, ...override });

test('M08 interpreter evaluates typed vector arithmetic, logical branches and easing without host coercion', () => {
	assert.deepEqual(evaluate('value + [2, 3, 4] * 2'), [14, 26, 38]); assert.equal(evaluate('time > 1 ? dot(value, [1, 0, 0]) : 0'), 10);
	assert.deepEqual(evaluate('linear(localTime, 0, 2, [0, 10], [20, 30])'), [10, 20]); assert.equal(evaluate('ease(0.5, 0, 1, 0, 100)'), 50);
	assert.equal(evaluate('false && (1 / 0)'), false); assert.equal(evaluate('true || (1 / 0)'), true);
	assert.throws(() => evaluate('"1" + 2'), /numeric|number/iu); assert.throws(() => evaluate('[1, 2] + [1, 2, 3]'), /dimension/iu);
});

test('M08 seeded random, noise and wiggle produce identical values after arbitrary seeking', () => {
	const source = parseMotionExpression('wiggle(2, [4, 8, 12], 3, 0.5, 17) + random(3, 0, 1)');
	const at = (time: number) => evaluateMotionExpression(source, { ...context, time });
	const sequential = [0, 0.1, 1, 1.5, 4].map(at); for (const index of [4, 0, 2, 1, 3, 0]) assert.deepEqual(at([0, 0.1, 1, 1.5, 4][index]!), sequential[index]);
	assert.notDeepEqual(at(0.1), at(1)); assert.notDeepEqual(at(0.1), evaluateMotionExpression(source, { ...context, time: 0.1, seed: 'another-property' }));
	assert.equal(evaluate('noise(1.25, 7)'), evaluate('noise(1.25, 7)'));
});

test('M08 reference, sampling, loops and audio requests use only explicit context capabilities', () => {
	const requests: unknown[] = [];
	assert.equal(evaluate('reference("gain") + valueAtTime("offset", time - 1)', { reference(id, time) { requests.push([id, time]); return id === 'gain' ? 2 : time! * 3; } }), 5);
	assert.deepEqual(requests, [['gain', undefined], ['offset', 1]]);
	assert.equal(evaluate('valueAtTime(time - 0.5)', { valueAtTime: (time) => time * 2 }), 3);
	assert.equal(evaluate('loopOut("pingpong", 2)', { loop(direction, mode, count) { assert.deepEqual([direction, mode, count], ['out', 'pingpong', 2]); return 4; } }), 4);
	assert.equal(evaluate('audioAmplitude("audio", localTime, 0.02)', { audioAmplitude(request) { assert.deepEqual(request, { assetId: 'audio', time: 1, windowSeconds: 0.02 }); return 0.25; } }), 0.25);
	assert.throws(() => evaluate('audioAmplitude("audio")'), /prepared|amplitude|unavailable/iu);
});

test('M08 interpretation refuses nonfinite arithmetic, invalid channels and procedural expansion bounds', () => {
	for (const source of ['1 / 0', 'sqrt(-1)', 'value[3]', 'value[0.5]', 'normalize([0, 0]) / 0', 'wiggle(2, 1, 100)', 'random(1, 3, 1)']) assert.throws(() => evaluate(source), Error, source);
	assert.deepEqual(evaluate('normalize([0, 0])'), [0, 0]); assert.deepEqual(evaluate('cross([1, 0, 0], [0, 1, 0])'), [0, 0, 1]);
});

test('M08 evaluation shares an operation budget across nested capabilities and checks cancellation', () => {
	const program = parseMotionExpression('value + [1, 2, 3]'); const budget = createMotionExpressionBudget({ maximumOperations: 4 });
	assert.throws(() => evaluateMotionExpression(program, context, budget), /budget/iu);
	const controller = new AbortController(); controller.abort();
	assert.throws(() => evaluateMotionExpression(program, context, createMotionExpressionBudget({ signal: controller.signal })), { name: 'AbortError' });
	const nestedBudget = createMotionExpressionBudget({ maximumOperations: 4 }); const nested = parseMotionExpression('1 + 2');
	assert.throws(() => evaluate('reference("a") + reference("a")', { reference: () => evaluateMotionExpression(nested, context, nestedBudget) as number }), /budget/iu);
});
