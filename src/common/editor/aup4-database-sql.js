/* SPDX-License-Identifier: AGPL-3.0-only */

// The narrow SQLite surface every AUP4 database operation goes through: the
// adapter that adjusts for whichever driver shape the caller supplied, bound
// statement execution and row reads, and the explicit transaction the writes
// commit or roll back inside. Split out of aup4-database.js; no behaviour
// changes here.

export function createAup4DatabaseAdapter(database) {
	if (!database || (typeof database.exec !== 'function' && typeof database.prepare !== 'function')) {
		throw new TypeError('An open SQLite database is required.');
	}
	return {
		database,
		exec(sql, bind) { return execute(database, sql, bind); },
		rows(sql, bind) { return queryRows(database, sql, bind); },
		value(sql, bind) { return queryRows(database, sql, bind)[0]?.[0]; },
		transaction(callback) { return transaction(database, callback); },
	};
}

export function positiveInteger(value, fallback) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function execute(database, sql, bind) {
	if (typeof database.run === 'function' && bind != null) {
		database.run(sql, bind || []);
		return database;
	}
	if (typeof database.run === 'function') {
		database.exec(sql);
		return database;
	}
	database.exec(bind == null ? sql : { sql, bind, returnValue: 'this' });
	return database;
}

export function queryRows(database, sql, bind) {
	if (typeof database.prepare === 'function' && typeof database.run === 'function') {
		const statement = database.prepare(sql);
		try {
			if (bind != null) statement.bind(bind);
			const rows = [];
			while (statement.step()) rows.push(statement.get());
			return rows;
		} finally {
			statement.free();
		}
	}
	return database.exec({ sql, ...(bind == null ? {} : { bind }), rowMode: 'array', returnValue: 'resultRows' }) || [];
}

export function transaction(database, callback) {
	execute(database, 'BEGIN IMMEDIATE');
	try {
		const result = callback();
		if (result && typeof result.then === 'function') throw new TypeError('AUP4 SQLite transactions must be synchronous inside their worker operation.');
		execute(database, 'COMMIT');
		return result;
	} catch (error) {
		try { execute(database, 'ROLLBACK'); } catch { /* Preserve the original error. */ }
		throw error;
	}
}

export function unixSeconds(value = Date.now()) {
	const milliseconds = value instanceof Date ? value.getTime() : Number(value);
	if (!Number.isFinite(milliseconds)) throw new TypeError('A valid save timestamp is required.');
	return Math.floor(milliseconds / 1000);
}

export function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A binary SQLite value is required.');
}
