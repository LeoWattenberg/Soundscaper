/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecursiveBinarySnapshotAuthority } from '../src/common/editor/commands/recursive-binary-snapshot.ts';

function ownData(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`not data: ${key}`);
	return descriptor.value;
}

test('recursive snapshots copy binary values and preserve their container kind', () => {
	const authority = createRecursiveBinarySnapshotAuthority(ownData);
	const bytes = new Uint8Array([1, 2, 3]);
	const snapshot = authority.snapshotValue({ nested: [bytes] });
	bytes[0] = 9;

	assert.equal(authority.sameSnapshot(snapshot, authority.snapshotValue({ nested: [new Uint8Array([1, 2, 3])] })), true);
	assert.equal(authority.sameSnapshot(snapshot, authority.snapshotValue({ nested: [new Uint8Array([1, 2, 4])] })), false);
	assert.equal(authority.sameSnapshot(
		authority.snapshotValue(new Uint8Array([1, 2])),
		authority.snapshotValue(new Uint8Array([1, 2]).buffer),
	), false);
});

test('recursive snapshots compare exact records and honor omitted fields', () => {
	const authority = createRecursiveBinarySnapshotAuthority(ownData);
	const left = authority.snapshotRecord({ z: 3, ignored: 1, a: [{ value: Number.NaN }] }, new Set(['ignored']));
	const right = authority.snapshotValue({ a: [{ value: Number.NaN }], z: 3 });

	assert.equal(authority.sameSnapshot(left, right), true);
	assert.equal(authority.sameSnapshot(left, authority.snapshotValue({ a: [{ value: 0 }], z: 3 })), false);
	assert.equal(authority.sameSnapshot(left, authority.snapshotValue({ a: [{ value: Number.NaN }], z: 3, extra: true })), false);
});

test('recursive snapshots use the caller data-property authority', () => {
	const authority = createRecursiveBinarySnapshotAuthority(ownData);
	const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
	assert.throws(() => authority.snapshotValue(accessor), /not data: value/u);
});
