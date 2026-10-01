/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	offlineVideoExportRecord,
	offlineVideoExportData,
	offlineVideoExportDenseArray,
	offlineVideoExportBoundedId,
} from '../src/common/editor/ui/video-keyframe-offline-video-export-admission.ts';

test('offline export record admission preserves identity, key order and mutable records', () => {
	for (const value of [{ second: 2, first: 1 }, Object.assign(Object.create(null) as object, { second: 2, first: 1 })]) {
		assert.equal(offlineVideoExportRecord(value, 'source'), value);
		assert.deepEqual(Reflect.ownKeys(value), ['second', 'first']);
		assert.equal(Object.isFrozen(value), false);
	}
	for (const value of [null, undefined, 1, 'source', [], new Date(), Object.create({}) as object]) {
		assert.throws(() => offlineVideoExportRecord(value, 'source'), { name: 'TypeError', message: 'source must be a plain record.' });
	}
});

test('offline export data admission requires enumerable own data and never executes accessors', () => {
	let reads = 0;
	const accessor = { get id() { reads += 1; return 'secret'; } };
	const hidden = Object.defineProperty({}, 'id', { value: 'hidden' });
	const inherited = Object.create({ id: 'inherited' }) as object;
	for (const value of [accessor, hidden, inherited, {}]) {
		assert.throws(() => offlineVideoExportData(value, 'id', 'source'), {
			name: 'TypeError', message: 'source.id must be an own data property.',
		});
	}
	assert.equal(reads, 0);
	assert.equal(offlineVideoExportData({ id: undefined }, 'id', 'source'), undefined);
});

test('offline export dense arrays freeze a private copy and preserve exact refusal order', () => {
	const item = { id: 'source' };
	const input = [item];
	const result = offlineVideoExportDenseArray(input, 'sources', 1);
	assert.notEqual(result, input);
	assert.equal(result[0], item);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(input), false);
	assert.equal(Object.isFrozen(item), false);
	for (const value of [null, {}, Object.setPrototypeOf([], null), [item, item]]) {
		assert.throws(() => offlineVideoExportDenseArray(value, 'sources', 1), {
			name: 'RangeError', message: 'sources must be a bounded ordinary array.',
		});
	}
	let reads = 0;
	const accessor = Object.defineProperty([item], '0', { enumerable: true, get() { reads += 1; return item; } });
	const hidden = Object.defineProperty([item], '0', { enumerable: false, value: item });
	for (const value of [Array<unknown>(1), accessor, hidden]) {
		assert.throws(() => offlineVideoExportDenseArray(value, 'sources', 1), {
			name: 'TypeError', message: 'sources must be dense own data.',
		});
	}
	assert.equal(reads, 0);
	for (const value of [Object.assign([item], { extra: true }), Object.assign([item], { [Symbol('extra')]: true })]) {
		assert.throws(() => offlineVideoExportDenseArray(value, 'sources', 1), {
			name: 'TypeError', message: 'sources cannot contain named fields.',
		});
	}
});

test('offline export IDs keep the exact one-to-256-character untrimmed contract', () => {
	for (const value of [' ', '\n', 'ä', 'x'.repeat(256)]) assert.equal(offlineVideoExportBoundedId(value, 'id'), value);
	for (const value of ['', 'x'.repeat(257), undefined, 1, {}]) {
		assert.throws(() => offlineVideoExportBoundedId(value, 'id'), { name: 'TypeError', message: 'id must be a bounded ID.' });
	}
});
