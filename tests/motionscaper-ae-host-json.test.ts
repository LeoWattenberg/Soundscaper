/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMotionAeHostJson, stringifyMotionAeHostJson } from '../src/common/editor/motion-ae-host-json.ts';
test('installed-AE JSON codec preserves Unicode and numbers without eval or a global JSON dependency', () => {
	const value = { text: 'Frame\n"one"\tä𝄞', values: [null, true, false, 1.125, -1e-8], nested: { name: 'shape' } };
	assert.deepEqual(parseMotionAeHostJson(JSON.stringify(value)), value);
	assert.deepEqual(JSON.parse(stringifyMotionAeHostJson(value)) as unknown, value);
	assert.throws(() => parseMotionAeHostJson('{"a":1,"a":2}'), /duplicate/u);
	assert.throws(() => parseMotionAeHostJson('{"__proto__":{}}'), /key/u);
	for (const source of ['[1,]', '{"a":undefined}', '({})', '1; alert("no")', '01', '1e999', '"unterminated']) assert.throws(() => parseMotionAeHostJson(source));
});
test('installed-AE JSON codec bounds nesting and values and rejects cyclic output', () => {
	assert.throws(() => parseMotionAeHostJson('['.repeat(66) + '0' + ']'.repeat(66)), /depth/u);
	assert.throws(() => parseMotionAeHostJson(' '.repeat(16_777_217)), /budget/u);
	const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
	assert.throws(() => stringifyMotionAeHostJson(cyclic), /cyclic/u);
	assert.throws(() => stringifyMotionAeHostJson({ value: Infinity }), /finite/u);
});
