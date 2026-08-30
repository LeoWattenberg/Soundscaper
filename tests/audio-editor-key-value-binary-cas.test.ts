/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

test('key/value CAS compares binary records without JSON expansion', async () => {
	const values = new KeyValueRepository({
		memory: getMemoryDatabase(`binary-cas-${crypto.randomUUID()}`),
		database: async () => null,
	}, 'analysis');
	const bytes = new Uint8Array(2 * 1_024 * 1_024);
	bytes[0] = 17;
	bytes[bytes.length - 1] = 29;
	const record = { version: 1, bytes };
	await values.put('large-binary', record);

	const changed = { version: 1, bytes: bytes.slice() };
	changed.bytes[1] = 1;
	assert.equal(await values.deleteIfCurrent('large-binary', changed), false);
	assert.equal(await values.deleteIfCurrent('large-binary', record), true);
});

test('key/value CAS atomically deletes a binary row while advancing its inventory', async () => {
	const values = new KeyValueRepository({
		memory: getMemoryDatabase(`binary-inventory-cas-${crypto.randomUUID()}`),
		database: async () => null,
	}, 'analysis');
	const payload = { version: 1, bytes: Uint8Array.of(1, 2, 3) };
	const inventory = { version: 1, keys: ['payload'] };
	const emptyInventory = { version: 1, keys: [] };
	await values.put('payload', payload);
	await values.put('inventory', inventory);

	assert.equal(await values.deleteIfCurrentAndUpdate(
		'payload', { ...payload, bytes: Uint8Array.of(9) },
		'inventory', inventory, emptyInventory,
	), false);
	assert.equal(await values.deleteIfCurrentAndUpdate(
		'payload', payload,
		'inventory', { version: 1, keys: [] }, emptyInventory,
	), false);
	assert.equal(await values.deleteIfCurrentAndUpdate(
		'payload', payload, 'inventory', inventory, emptyInventory,
	), true);
	assert.equal(await values.get('payload'), undefined);
	assert.deepEqual(await values.get('inventory'), emptyInventory);
});
