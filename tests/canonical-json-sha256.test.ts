/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';

test('canonical authority is independent of plain-record key insertion order', () => {
	assert.equal(
		canonicalJsonSha256({ alpha: 1, beta: [true, null] }),
		canonicalJsonSha256({ beta: [true, null], alpha: 1 }),
	);
});

test('canonical arrays require dense own enumerable data indices and no extra authority', () => {
	assert.throws(() => canonicalJsonSha256(Array(1)), /dense|array/iu);
	const named = [1] as number[] & { label?: string };
	named.label = 'hidden authority';
	assert.throws(() => canonicalJsonSha256(named), /array|extra/iu);
	const symbolled = [1];
	Object.defineProperty(symbolled, Symbol('authority'), { value: true, enumerable: true });
	assert.throws(() => canonicalJsonSha256(symbolled), /array|extra/iu);
	const inherited = [1];
	Object.setPrototypeOf(inherited, null);
	assert.throws(() => canonicalJsonSha256(inherited), /prototype|array/iu);
});

test('canonical arrays reject accessors without invoking them', () => {
	let invoked = false;
	const accessor = [0];
	Object.defineProperty(accessor, '0', {
		enumerable: true,
		get() { invoked = true; return 1; },
	});
	assert.throws(() => canonicalJsonSha256(accessor), /data|array/iu);
	assert.equal(invoked, false);
});

test('canonical values reject cyclic record and array authority', () => {
	const record: Record<string, unknown> = {};
	record.self = record;
	assert.throws(() => canonicalJsonSha256(record), /cyclic/iu);

	const array: unknown[] = [];
	array.push(array);
	assert.throws(() => canonicalJsonSha256(array), /cyclic/iu);
});

test('canonical records reject symbol and non-enumerable authority', () => {
	const symbolled = { value: 1 } as Record<PropertyKey, unknown>;
	symbolled[Symbol('authority')] = true;
	assert.throws(() => canonicalJsonSha256(symbolled), /enumerable|record|symbol/iu);
	const hidden = { value: 1 };
	Object.defineProperty(hidden, 'authority', { value: true });
	assert.throws(() => canonicalJsonSha256(hidden), /enumerable|record/iu);
});

test('supported binary authority has type-bound bytes and rejects extra properties', () => {
	assert.notEqual(
		canonicalJsonSha256(Uint8Array.of(1, 2)),
		canonicalJsonSha256(Uint8Array.of(1, 3)),
	);
	assert.notEqual(
		canonicalJsonSha256(Uint8Array.of(1, 2)),
		canonicalJsonSha256(Uint8Array.of(1, 2).buffer),
	);
	const extended = Uint8Array.of(1) as Uint8Array & { authority?: boolean };
	extended.authority = true;
	assert.throws(() => canonicalJsonSha256(extended), /binary|property/iu);
});

test('binary authority rejects other views, subclasses, and ArrayBuffer properties', () => {
	assert.throws(
		() => canonicalJsonSha256(new Uint16Array([1])),
		/only Uint8Array and ArrayBuffer/iu,
	);

	class DerivedUint8Array extends Uint8Array {}
	assert.throws(
		() => canonicalJsonSha256(new DerivedUint8Array([1])),
		/ordinary binary prototype/iu,
	);

	const extended = new ArrayBuffer(1) as ArrayBuffer & { authority?: boolean };
	extended.authority = true;
	assert.throws(
		() => canonicalJsonSha256(extended),
		/custom prototype or extra properties/iu,
	);
});

test('detached and out-of-bounds binary authority is rejected with a closed error', () => {
	const detachedBuffer = new ArrayBuffer(1);
	structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
	assertClosedBinaryRefusal(detachedBuffer);

	const detachedBacking = new ArrayBuffer(1);
	const detachedView = new Uint8Array(detachedBacking);
	structuredClone(detachedBacking, { transfer: [detachedBacking] });
	assertClosedBinaryRefusal(detachedView);

	const ResizableArrayBuffer = ArrayBuffer as unknown as new (
		byteLength: number,
		options: Readonly<{ maxByteLength: number }>,
	) => ArrayBuffer & { resize(byteLength: number): void };
	const resizable = new ResizableArrayBuffer(4, { maxByteLength: 8 });
	const outOfBounds = new Uint8Array(resizable, 2, 2);
	resizable.resize(1);
	assertClosedBinaryRefusal(outOfBounds);
});

function assertClosedBinaryRefusal(value: ArrayBuffer | Uint8Array): void {
	assert.throws(
		() => canonicalJsonSha256(value),
		(error: unknown) => error instanceof TypeError
			&& /Canonical JSON binary authority is detached or out of bounds/u.test(error.message),
	);
}
