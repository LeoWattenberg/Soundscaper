/* SPDX-License-Identifier: AGPL-3.0-only */

/** Share the immediate SQLite write boundary without owning product-specific admission. */

import type { DatabaseSync } from 'node:sqlite';

export function withProjectLibraryImmediateTransaction<Result>(
	database: DatabaseSync,
	operation: () => Result,
	options: Readonly<{ rollbackWhenInactive?: boolean }> = {},
): Result {
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = operation();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		if (options.rollbackWhenInactive || database.isTransaction) database.exec('ROLLBACK');
		throw error;
	}
}
