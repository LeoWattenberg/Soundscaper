/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';
import { translateMotionAeScalarExpression } from '../src/common/editor/motion-ae-expression-conversion.ts';
import { parseMotionExpression } from '../src/common/editor/motion-expression-parser.ts';
import { evaluateMotionExpression } from '../src/common/editor/motion-expression-evaluator.ts';

function motion(source: string, time: number, value: number): number {
	const result = evaluateMotionExpression(parseMotionExpression(source), { time, localTime: time - .5, frame: time * 30, frameRate: 30, value, index: 7, seed: 'expression-reference' });
	if (typeof result !== 'number') throw new Error('Expected scalar Motion result'); return result;
}
function javascript(source: string, time: number, value: number): number {
	const result: unknown = new Script(source).runInNewContext({ time, value }, { timeout: 100 });
	if (typeof result !== 'number') throw new Error('Expected scalar JavaScript result'); return result;
}
function near(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${actual} must match ${expected}`);
}

test('portable AE scalar expressions preserve composition time and scaled pre-expression values', () => {
	for (const source of ['value + time * 10;', 'Math.sin(time * Math.PI) * 20 + value', 'time < 1 ? value : Math.max(10, value / 2)', '!(time > 1) ? Math.pow(value, 2) : Math.abs(value - 30)', 'time === 0 || time < 1 ? Math.floor(value) : Math.ceil(value)']) {
		for (const scale of [.01, 1, 100]) {
			const translated = translateMotionAeScalarExpression(source, { direction: 'from-after-effects', scale });
			assert.equal(translated.status, 'translated'); assert.ok(translated.source);
			for (const time of [0, .25, 1, 1.75]) for (const value of [-3.125, 0, 25.5]) near(motion(translated.source, time, value * scale), javascript(source, time, value) * scale);
		}
	}
});

test('Motion scalar expressions emit closed Math syntax with portable power and percentage conversion', () => {
	for (const source of ['value + sin(time*pi)*.25', 'value ** 2 + time', 'time < 1 ? min(value, .5) : max(value, .2)', '(time >= 0 && time < 1) ? value : abs(value - .5)']) {
		const exported = translateMotionAeScalarExpression(source, { direction: 'to-after-effects', scale: 100 });
		assert.equal(exported.status, 'translated'); assert.ok(exported.source); assert.ok(!exported.source.includes('**'));
		for (const time of [0, .5, 1, 2]) for (const value of [0, .25, .75]) near(javascript(exported.source, time, value * 100), motion(source, time, value) * 100);
		const returned = translateMotionAeScalarExpression(exported.source, { direction: 'from-after-effects', scale: .01 });
		assert.equal(returned.status, 'translated'); assert.ok(returned.source);
		near(motion(returned.source, .75, .25), motion(source, .75, .25));
	}
});

test('expression translation refuses host access, side effects, procedural differences and non-scalar coercion', () => {
	for (const direction of ['from-after-effects', 'to-after-effects'] as const) for (const source of [
		'var x=1; x', 'value=2', 'thisComp.layer(1).rotation', 'Math.random()', 'Math.constructor("return process")()',
		'wiggle(2, 20)', 'noise(time)', 'random(0, 1)', 'reference("other")', 'valueAtTime(time)', 'audioAmplitude("music")', 'loopOut()',
		'localTime*10', 'frame', 'index', 'frameRate', '[time,time]', 'value[0]', 'true + 1', 'time == true ? 1 : 2', 'time ? 1 : false', '"1"',
		'time || false',
	]) {
		const converted = translateMotionAeScalarExpression(source, { direction, scale: 1 });
		assert.equal(converted.status, 'unsupported', `${direction}: ${source}`); assert.equal(converted.source, null); assert.match(converted.message, /sample|render/iu);
	}
	for (const source of ['sin(time)', 'pi*time', 'value ** 2']) assert.equal(translateMotionAeScalarExpression(source, { direction: 'from-after-effects', scale: 1 }).status, 'unsupported');
});

test('translated math domain failures remain actionable expression diagnostics', () => {
	const converted = translateMotionAeScalarExpression('Math.sqrt(-1)', { direction: 'from-after-effects', scale: 1 });
	assert.equal(converted.status, 'translated'); assert.ok(converted.source);
	assert.throws(() => motion(converted.source!, 0, 1), /non-finite/u);
});

test('translation retains source custody and respects parser, output and mapping bounds', () => {
	const source = '/* original capture */ value + time;';
	const converted = translateMotionAeScalarExpression(source, { direction: 'from-after-effects', scale: .01 });
	assert.equal(source, '/* original capture */ value + time;'); assert.equal(converted.status, 'translated');
	for (const text of ['x'.repeat(16_385), '1+'.repeat(2048) + '1']) assert.equal(translateMotionAeScalarExpression(text, { direction: 'from-after-effects', scale: 1 }).status, 'unsupported');
	for (const scale of [0, -1, NaN, Infinity, 1e20]) assert.throws(() => translateMotionAeScalarExpression('value', { direction: 'to-after-effects', scale }), /mapping/u);
});
