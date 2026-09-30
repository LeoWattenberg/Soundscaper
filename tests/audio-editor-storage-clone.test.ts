/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { cloneStorageValue } from '../src/common/editor/storage/storage-clone.ts';

test('storage cloning falls back to a nullable-safe detached JSON snapshot', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
	Object.defineProperty(globalThis, 'structuredClone', {
		configurable: true,
		value: undefined,
		writable: true,
	});
	try {
		const input = { nested: { values: [1, 2, 3] }, nullable: null };
		const snapshot = cloneStorageValue(input);

		assert.deepEqual(snapshot, input);
		assert.notStrictEqual(snapshot, input);
		assert.notStrictEqual(snapshot.nested, input.nested);
		assert.equal(cloneStorageValue(null), null);
		assert.equal(cloneStorageValue(undefined), undefined);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor);
		else Reflect.deleteProperty(globalThis, 'structuredClone');
	}
});
