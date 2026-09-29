/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	denseArray,
	exactRecord,
	snapshotDeliveryReport,
} from '../src/framescaper/delivery-native-report-validation-v1.ts';

function report() {
	return {
		schemaVersion: 1, format: 'delivery', direction: 'export',
		subject: {
			format: 'mov', container: 'mov', codec: 'prores',
			sampleRate: 48_000, channelCount: 2, lossless: false,
		},
		items: [{
			code: 'delivery.picture', severity: 'info', disposition: 'preserved',
			scope: { kind: 'delivery' }, data: { nested: { frames: [1, 2] } },
		}],
		counts: { preserved: 1, converted: 0, missing: 0, omitted: 0 },
	};
}

test('required report fields must be data properties without invoking accessors', () => {
	let called = false;
	const row = Object.defineProperty({}, 'status', {
		enumerable: true,
		get() { called = true; throw new Error('getter ran'); },
	});
	assert.throws(() => exactRecord(row, ['status'], 'status'), /data propert/iu);
	assert.equal(called, false);
});

test('optional report fields must be data properties when present', () => {
	let called = false;
	const row = Object.defineProperty({ status: 'ok' }, 'detail', {
		enumerable: true,
		get() { called = true; return 'hidden'; },
	});
	assert.throws(() => exactRecord(row, ['status', 'detail'], 'status', ['detail']), /data propert/iu);
	assert.equal(called, false);
});

test('non-enumerable report fields cannot satisfy a required field', () => {
	const row = Object.defineProperty({}, 'status', { value: 'ok' });
	assert.throws(() => exactRecord(row, ['status'], 'status'), /enumerable/iu);
});

test('symbol fields cannot hide alongside allowed report fields', () => {
	const row = { status: 'ok', [Symbol('hidden')]: 1 };
	assert.throws(() => exactRecord(row, ['status'], 'status'), /unsupported/iu);
});

test('a sparse report array cannot compensate for a hole with an extra property', () => {
	const rows = new Array<unknown>(2);
	rows[0] = 'first';
	Object.assign(rows, { extra: 'hidden' });
	assert.throws(() => denseArray(rows, 0, 2, 'rows'), /dense array/iu);
});

test('report arrays reject accessor elements without invoking them', () => {
	let called = false;
	const rows = Object.defineProperty(['first'], 0, {
		enumerable: true,
		get() { called = true; return 'second'; },
	});
	assert.throws(() => denseArray(rows, 0, 1, 'rows'), /data propert/iu);
	assert.equal(called, false);
});

test('report arrays reject an extra property even when every element is present', () => {
	const rows = Object.assign(['first'], { extra: 'hidden' });
	assert.throws(() => denseArray(rows, 0, 1, 'rows'), /dense array/iu);
});

test('nested report scope accessors are refused before cloning can invoke them', () => {
	const value = report();
	let called = false;
	value.items[0]!.scope = Object.defineProperty({}, 'kind', {
		enumerable: true,
		get() { called = true; return 'delivery'; },
	}) as { kind: string };
	assert.throws(() => snapshotDeliveryReport(value), /own data propert/iu);
	assert.equal(called, false);
});

test('nested report data accessors are refused before cloning can invoke them', () => {
	const value = report();
	let called = false;
	value.items[0]!.data = Object.defineProperty({}, 'nested', {
		enumerable: true,
		get() { called = true; return { frames: [1, 2] }; },
	}) as { nested: { frames: number[] } };
	assert.throws(() => snapshotDeliveryReport(value), /own data propert/iu);
	assert.equal(called, false);
});

test('report snapshots own detached, deeply frozen item data', () => {
	const value = report();
	const snapshot = snapshotDeliveryReport(value);
	value.items[0]!.data.nested.frames[0] = 99;
	assert.deepEqual(snapshot.items[0]!.data, { nested: { frames: [1, 2] } });
	assert.equal(Object.isFrozen(snapshot.items[0]!.data), true);
	assert.equal(Object.isFrozen((snapshot.items[0]!.data.nested as { frames: number[] }).frames), true);
});

test('delivery report counts must equal the disposition inventory', () => {
	const value = report();
	value.counts.preserved = 0;
	assert.throws(() => snapshotDeliveryReport(value), /counts do not describe/iu);
});

test('delivery report snapshots reject unsupported top-level fields', () => {
	assert.throws(() => snapshotDeliveryReport({ ...report(), draft: true }), /unsupported fields/iu);
});
