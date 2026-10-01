/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captureSpoolDataRecord,
	captureSpoolExactSum,
	captureSpoolStableId,
	captureSpoolStableText,
} from '../src/common/editor/storage/capture-spool-validation.ts';

test('capture-spool text validation preserves canonical bounded identifiers', () => {
	assert.equal(captureSpoolStableText('café', 'text', 4), 'café');
	assert.equal(captureSpoolStableId('a'.repeat(256), 'id'), 'a'.repeat(256));
	for (const value of ['', ' padded', 'e\u0301', 'control\u0000']) {
		assert.throws(() => captureSpoolStableText(value, 'text', 256), /text is invalid/u);
	}
	assert.throws(() => captureSpoolStableId('a'.repeat(257), 'id'), /id is invalid/u);
});

test('capture-spool loose data records admit non-array objects without reading fields', () => {
	let getterCalls = 0;
	const record = Object.defineProperty(Object.create(null) as Record<string, unknown>, 'value', {
		enumerable: true,
		get() { getterCalls += 1; return 1; },
	});
	assert.strictEqual(captureSpoolDataRecord(record, 'record'), record);
	assert.equal(getterCalls, 0);
	assert.throws(() => captureSpoolDataRecord([], 'record'), /record must be a data record/u);
	assert.throws(() => captureSpoolDataRecord(null, 'record'), /record must be a data record/u);
});

test('capture-spool exact sums preserve safe-integer overflow diagnostics', () => {
	assert.equal(captureSpoolExactSum(4, 5, 'size'), 9);
	assert.throws(
		() => captureSpoolExactSum(Number.MAX_SAFE_INTEGER, 1, 'size'),
		/size exceeds the safe integer range/u,
	);
});
