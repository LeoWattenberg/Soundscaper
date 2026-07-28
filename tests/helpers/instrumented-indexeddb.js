/* SPDX-License-Identifier: AGPL-3.0-only */

export function createInstrumentedIndexedDB({ supportsContinuePrimaryKey = true } = {}) {
	const databases = new Map();
	const stats = {
		activeTransactions: 0,
		maximumActiveTransactions: 0,
		cursorRequests: [],
		keyCursorRequests: [],
		getAllRequests: [],
		getRequests: [],
		sourceChunkGetAllCalls: 0,
		supportsContinuePrimaryKey,
	};
	return {
		stats,
		open(name) {
			const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
			queueMicrotask(() => {
				let database = databases.get(name);
				const needsUpgrade = !database;
				if (!database) {
					database = new FakeDatabase(stats);
					databases.set(name, database);
				}
				request.result = database;
				if (needsUpgrade) request.onupgradeneeded?.();
				queueMicrotask(() => request.onsuccess?.());
			});
			return request;
		},
		recordCount(databaseName, storeName) {
			return databases.get(databaseName)?.stores.get(storeName)?.records.size || 0;
		},
		records(databaseName, storeName) {
			return [...(databases.get(databaseName)?.stores.get(storeName)?.records.values() || [])]
				.map(clone)
				.sort((left, right) => compareKeys(
					left[databases.get(databaseName).stores.get(storeName).keyPath],
					right[databases.get(databaseName).stores.get(storeName).keyPath],
				));
		},
		seedRecord(databaseName, storeName, value) {
			const store = databases.get(databaseName)?.stores.get(storeName);
			if (!store) throw new Error(`Store ${storeName} has not been created.`);
			const stored = clone(value);
			store.records.set(stored[store.keyPath], stored);
		},
	};
}

class FakeDatabase {
	constructor(stats) {
		this.stats = stats;
		this.stores = new Map();
		this.objectStoreNames = { contains: (name) => this.stores.has(name) };
	}

	createObjectStore(name, { keyPath }) {
		const data = { name, keyPath, records: new Map(), indexes: new Map() };
		this.stores.set(name, data);
		return {
			createIndex: (indexName, indexKeyPath) => data.indexes.set(indexName, indexKeyPath),
		};
	}

	transaction(storeNames, mode) {
		return new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames], mode);
	}

	close() {}
}

class FakeTransaction {
	constructor(database, storeNames, mode) {
		this.database = database;
		this.storeNames = new Set(storeNames);
		this.mode = mode;
		this.pending = 0;
		this.finished = false;
		this.completionScheduled = false;
		this.error = null;
		this.oncomplete = null;
		this.onabort = null;
		this.onerror = null;
		database.stats.activeTransactions += 1;
		database.stats.maximumActiveTransactions = Math.max(
			database.stats.maximumActiveTransactions,
			database.stats.activeTransactions,
		);
		this.scheduleCompletion();
	}

	objectStore(name) {
		if (!this.storeNames.has(name)) throw new Error(`Store ${name} is outside this transaction.`);
		return new FakeObjectStore(this, this.database.stores.get(name));
	}

	beginRequest() {
		if (this.finished) throw new Error('The transaction is inactive.');
		this.pending += 1;
	}

	endRequest() {
		this.pending -= 1;
		this.scheduleCompletion();
	}

	scheduleCompletion() {
		if (this.completionScheduled || this.finished) return;
		this.completionScheduled = true;
		setImmediate(() => {
			this.completionScheduled = false;
			if (this.finished || this.pending) return;
			this.finished = true;
			this.database.stats.activeTransactions -= 1;
			this.oncomplete?.();
		});
	}

	abort() {
		if (this.finished) return;
		this.finished = true;
		this.database.stats.activeTransactions -= 1;
		queueMicrotask(() => this.onabort?.());
	}
}

class FakeObjectStore {
	constructor(transaction, data) {
		this.transaction = transaction;
		this.data = data;
	}

	put(value) {
		return fakeRequest(this.transaction, () => {
			const stored = clone(value);
			this.data.records.set(stored[this.data.keyPath], stored);
			return stored[this.data.keyPath];
		});
	}

	get(key) {
		return fakeRequest(this.transaction, () => {
			const value = this.data.records.get(key);
			this.transaction.database.stats.getRequests.push({
				store: this.data.name,
				key,
				...blobReadStats(value === undefined ? [] : [value]),
			});
			return clone(value);
		});
	}

	getAll(query, count) {
		if (this.data.name === 'sourceChunks') this.transaction.database.stats.sourceChunkGetAllCalls += 1;
		return fakeGetAllRequest(this.transaction, this.data, null, query, count, valuesForStore(this.data, query));
	}

	count(query) {
		return fakeRequest(this.transaction, () => valuesForStore(this.data, query).length);
	}

	delete(key) {
		return fakeRequest(this.transaction, () => this.data.records.delete(key));
	}

	clear() {
		return fakeRequest(this.transaction, () => this.data.records.clear());
	}

	index(name) {
		return new FakeIndex(this.transaction, this.data, name);
	}

	openCursor(query) {
		const entries = valuesForStore(this.data, query).map((value) => ({
			key: value[this.data.keyPath],
			primaryKey: value[this.data.keyPath],
			value,
		}));
		return fakeCursorRequest(this.transaction, this.data, entries, { index: null, query });
	}

	openKeyCursor(query, direction = 'next') {
		const entries = valuesForStore(this.data, query).map((value) => ({
			key: value[this.data.keyPath],
			primaryKey: value[this.data.keyPath],
		}));
		if (direction === 'prev' || direction === 'prevunique') entries.reverse();
		return fakeKeyCursorRequest(this.transaction, this.data, entries, { index: null, query, direction });
	}
}

class FakeIndex {
	constructor(transaction, data, name) {
		this.transaction = transaction;
		this.data = data;
		this.name = name;
		this.keyPath = data.indexes.get(name);
	}

	getAll(query, count) {
		if (this.data.name === 'sourceChunks') this.transaction.database.stats.sourceChunkGetAllCalls += 1;
		return fakeGetAllRequest(this.transaction, this.data, this.name, query, count, this.values(query));
	}

	openCursor(query) {
		const entries = this.values(query).map((value) => ({
			key: value[this.keyPath],
			primaryKey: value[this.data.keyPath],
			value,
		}));
		return fakeCursorRequest(this.transaction, this.data, entries, { index: this.name, query });
	}

	values(query) {
		return [...this.data.records.values()]
			.filter((value) => query === undefined || value[this.keyPath] === query)
			.sort((left, right) => compareKeys(left[this.keyPath], right[this.keyPath])
				|| compareKeys(left[this.data.keyPath], right[this.data.keyPath]));
	}
}

function fakeRequest(transaction, operation) {
	const request = { result: undefined, error: null, onsuccess: null, onerror: null };
	transaction.beginRequest();
	queueMicrotask(() => {
		try {
			request.result = operation();
			request.onsuccess?.();
		} catch (error) {
			request.error = error;
			request.onerror?.();
		} finally {
			transaction.endRequest();
		}
	});
	return request;
}

function fakeGetAllRequest(transaction, data, index, query, count, values) {
	return fakeRequest(transaction, () => {
		const returnedValues = values.slice(0, count);
		transaction.database.stats.getAllRequests.push({
			store: data.name,
			index,
			query,
			...blobReadStats(returnedValues),
		});
		return returnedValues.map(clone);
	});
}

function fakeCursorRequest(transaction, data, entries, { index, query }) {
	const request = { result: undefined, error: null, onsuccess: null, onerror: null };
	const requestStats = {
		store: data.name,
		index,
		query,
		delivered: 0,
		blobValuesDelivered: 0,
		blobBytesDelivered: 0,
	};
	transaction.database.stats.cursorRequests.push(requestStats);
	transaction.beginRequest();
	let position = 0;
	const deliver = () => queueMicrotask(() => {
		if (position >= entries.length) {
			request.result = null;
			request.onsuccess?.();
			transaction.endRequest();
			return;
		}
		const entry = entries[position];
		let continued = false;
		requestStats.delivered += 1;
		const payload = blobPayloadStats(entry.value);
		if (payload.count) requestStats.blobValuesDelivered += 1;
		requestStats.blobBytesDelivered += payload.bytes;
		const cursor = {
			key: entry.key,
			primaryKey: entry.primaryKey,
			value: clone(entry.value),
			continue(targetKey) {
				if (continued) throw new Error('The cursor has already advanced.');
				continued = true;
				position += 1;
				if (targetKey !== undefined) {
					while (position < entries.length && compareKeys(entries[position].key, targetKey) < 0) position += 1;
				}
				deliver();
			},
			continuePrimaryKey(targetKey, targetPrimaryKey) {
				if (continued) throw new Error('The cursor has already advanced.');
				continued = true;
				position += 1;
				while (position < entries.length && (
					compareKeys(entries[position].key, targetKey) < 0
					|| (compareKeys(entries[position].key, targetKey) === 0
						&& compareKeys(entries[position].primaryKey, targetPrimaryKey) < 0)
				)) position += 1;
				deliver();
			},
			delete() {
				data.records.delete(entry.primaryKey);
			},
		};
		if (!transaction.database.stats.supportsContinuePrimaryKey) delete cursor.continuePrimaryKey;
		request.result = cursor;
		request.onsuccess?.();
		if (!continued) transaction.endRequest();
	});
	deliver();
	return request;
}

function fakeKeyCursorRequest(transaction, data, entries, { index, query, direction }) {
	const request = { result: undefined, error: null, onsuccess: null, onerror: null };
	const requestStats = { store: data.name, index, query, direction, delivered: 0 };
	transaction.database.stats.keyCursorRequests.push(requestStats);
	transaction.beginRequest();
	let position = 0;
	const deliver = () => queueMicrotask(() => {
		if (position >= entries.length) {
			request.result = null;
			request.onsuccess?.();
			transaction.endRequest();
			return;
		}
		const entry = entries[position];
		let continued = false;
		requestStats.delivered += 1;
		request.result = {
			key: entry.key,
			primaryKey: entry.primaryKey,
			continue() {
				if (continued) throw new Error('The cursor has already advanced.');
				continued = true;
				position += 1;
				deliver();
			},
		};
		request.onsuccess?.();
		if (!continued) transaction.endRequest();
	});
	deliver();
	return request;
}

function valuesForStore(data, query) {
	return [...data.records.values()]
		.filter((value) => query === undefined || value[data.keyPath] === query)
		.sort((left, right) => compareKeys(left[data.keyPath], right[data.keyPath]));
}

function compareKeys(left, right) {
	if (left === right) return 0;
	return String(left) < String(right) ? -1 : 1;
}

function blobReadStats(values) {
	let blobValuesReturned = 0;
	let blobBytesReturned = 0;
	for (const value of values) {
		const payload = blobPayloadStats(value);
		if (payload.count) blobValuesReturned += 1;
		blobBytesReturned += payload.bytes;
	}
	return {
		returned: values.length,
		blobValuesReturned,
		blobBytesReturned,
	};
}

function blobPayloadStats(value, seen = new WeakSet()) {
	if (!value || typeof value !== 'object') return { count: 0, bytes: 0 };
	if (typeof Blob === 'function' && value instanceof Blob) return { count: 1, bytes: value.size };
	if (seen.has(value)) return { count: 0, bytes: 0 };
	seen.add(value);
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Date) {
		return { count: 0, bytes: 0 };
	}
	const nested = value instanceof Map
		? [...value.entries()].flat()
		: value instanceof Set
			? [...value.values()]
			: Object.values(value);
	return nested.reduce((total, child) => {
		const payload = blobPayloadStats(child, seen);
		return { count: total.count + payload.count, bytes: total.bytes + payload.bytes };
	}, { count: 0, bytes: 0 });
}

function clone(value) {
	return value === undefined ? undefined : structuredClone(value);
}
