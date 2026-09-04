/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MACRO_MAX_VALUE_DEPTH,
	MACRO_MAX_VALUE_ITEMS,
	MACRO_PROTOCOL_VERSION,
	MACRO_SOURCE_LINE_OFFSET,
	authorLine,
	createMacroValueBudget,
	normalizeMacroValue,
	readMacroWorkerMessage,
} from '../src/common/editor/macro-script/protocol.ts';

const admit = (value: unknown) => normalizeMacroValue(value, 'value');

test('only plain data crosses the boundary', () => {
	assert.deepEqual(admit({ a: 1, b: 'two', c: [true, null], d: { e: 0.5 } }),
		{ a: 1, b: 'two', c: [true, null], d: { e: 0.5 } });
	assert.equal(admit(undefined), null);
	// An absent object entry is dropped rather than becoming null, so a sparse
	// command parameter set stays sparse across the wire.
	assert.deepEqual(admit({ kept: 1, absent: undefined }), { kept: 1 });
	assert.ok(Object.isFrozen(admit({ a: 1 })));

	for (const value of [
		() => undefined, Symbol('x'), 10n, new Date(), new Map(), new Set(),
		/regex/u, new Uint8Array(2), Object.create({ inherited: true }),
	]) {
		assert.throws(() => admit(value), /cannot cross the boundary/u, String(typeof value));
	}
});

test('the values that would smuggle undefined behaviour into a parameter are refused', () => {
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		assert.throws(() => admit(value), /finite/u);
	}
	assert.throws(() => admit({ gain: Number.NaN }), /value\.gain must be a finite number/u);
});

test('depth, item count and total size are all bounded', () => {
	let deep: unknown = 'leaf';
	for (let level = 0; level <= MACRO_MAX_VALUE_DEPTH; level += 1) deep = { deep };
	assert.throws(() => admit(deep), /nested deeper/u);

	assert.throws(() => admit(new Array(MACRO_MAX_VALUE_ITEMS + 1).fill(0)), /more than/u);
	// The size budget is cumulative across the whole value, not per string, so a
	// wide structure of small strings cannot slip past it.
	const budget = createMacroValueBudget({ maxBytes: 32 });
	assert.throws(
		() => normalizeMacroValue(['12345678', '12345678', '12345678', '12345678', '1'], 'value', budget),
		/larger than 32 bytes/u,
	);
});

test('a call is admitted only in order, at this version, for this run', () => {
	const call = {
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'call', runId: 'run-1',
		callId: 1, method: 'selection.set', args: [0, 100],
	};
	assert.deepEqual(readMacroWorkerMessage(call, 'run-1', 0), { ...call, args: [0, 100] });

	assert.throws(() => readMacroWorkerMessage(call, 'run-2', 0), /different run/u);
	assert.throws(() => readMacroWorkerMessage(call, 'run-1', 1), /out of order/u);
	assert.throws(() => readMacroWorkerMessage({ ...call, callId: 3 }, 'run-1', 0), /out of order/u);
	assert.throws(() => readMacroWorkerMessage({ ...call, protocolVersion: 2 }, 'run-1', 0), /protocol version/u);
	assert.throws(() => readMacroWorkerMessage({ ...call, method: '' }, 'run-1', 0), /name a method/u);
	assert.throws(() => readMacroWorkerMessage({ ...call, type: 'evaluate' }, 'run-1', 0), /Unsupported macro message/u);
	assert.throws(() => readMacroWorkerMessage('call', 'run-1', 0), /must be an object/u);
});

test('log and terminal messages are bounded and normalized', () => {
	const log = readMacroWorkerMessage({
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'log', runId: 'run-1',
		entries: [{ level: 'warn', text: 'careful', at: 4 }, { text: 'x'.repeat(5_000) }, 'nonsense'],
	}, 'run-1', 0) as { entries: readonly { level: string; text: string; at: number }[] };
	assert.deepEqual(log.entries[0], { level: 'warn', text: 'careful', at: 4 });
	assert.equal(log.entries[1]?.level, 'info');
	assert.equal(log.entries[1]?.text.length, 4_096);
	assert.deepEqual(log.entries[2], { level: 'info', text: '', at: 0 });

	const failed = readMacroWorkerMessage({
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'failed', runId: 'run-1',
		message: 'boom', line: MACRO_SOURCE_LINE_OFFSET + 7, column: 3,
	}, 'run-1', 0);
	assert.deepEqual(failed, {
		protocolVersion: MACRO_PROTOCOL_VERSION, type: 'failed', runId: 'run-1',
		message: 'boom', line: 7, column: 3,
	});
});

test('a reported line is the author\'s own, or nothing', () => {
	// A program is spliced under a fixed wrapper, so an engine's line number is
	// always that much further down than the line the author is looking at.
	assert.equal(authorLine(MACRO_SOURCE_LINE_OFFSET + 1), 1);
	assert.equal(authorLine(MACRO_SOURCE_LINE_OFFSET), null, 'the wrapper is not the author\'s code');
	assert.equal(authorLine(1), null);
	assert.equal(authorLine(undefined), null);
	assert.equal(authorLine('7'), null);
});
