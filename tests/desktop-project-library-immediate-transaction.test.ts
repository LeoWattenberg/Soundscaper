/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { withProjectLibraryImmediateTransaction } from '../desktop/project-library-immediate-transaction.ts';

test('library transaction commits one operation and rolls back every failing operation', () => {
	const database = new DatabaseSync(':memory:');
	try {
		database.exec('CREATE TABLE value (number INTEGER NOT NULL)');
		assert.equal(withProjectLibraryImmediateTransaction(database, () => {
			database.exec('INSERT INTO value VALUES (1)');
			return 42;
		}), 42);
		assert.throws(() => withProjectLibraryImmediateTransaction(database, () => {
			database.exec('INSERT INTO value VALUES (2)');
			throw new Error('operation failed');
		}), /operation failed/u);
		assert.deepEqual(database.prepare('SELECT number FROM value').all().map((row) => row.number), [1]);
		assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});

test('library transaction leaves caller-specific preconditions outside its authority', () => {
	const database = new DatabaseSync(':memory:');
	try {
		assert.throws(() => withProjectLibraryImmediateTransaction(database, () => {
			throw new Error('caller identity check');
		}), /caller identity check/u);
		assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});
