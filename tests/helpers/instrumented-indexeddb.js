/* SPDX-License-Identifier: AGPL-3.0-only */

export function createInstrumentedIndexedDB({ supportsContinuePrimaryKey = true } = {}) {
	const databases = new Map();
	const pendingPutFailures = new Map();
	const pendingGetObservers = new Map();
	const stats = {
		activeTransactions: 0,
		maximumActiveTransactions: 0,
		cursorRequests: [],
		keyCursorRequests: [],
		getAllRequests: [],
		getRequests: [],
		takeGetObserver: (storeName) => pendingGetObservers.get(storeName),
		sourceChunkGetAllCalls: 0,
		supportsContinuePrimaryKey,
	};
	return {
		stats,
		open(name, version) {
			const requestedVersion = normalizeVersion(version);
			const request = {
				result: null,
				error: null,
				transaction: null,
				onsuccess: null,
				onerror: null,
				onblocked: null,
				onupgradeneeded: null,
			};
			queueMicrotask(() => {
				let database = databases.get(name);
				if (!database) {
					database = new FakeDatabase(stats, (storeName) => {
						const failure = pendingPutFailures.get(storeName);
						if (failure) pendingPutFailures.delete(storeName);
						return failure;
					});
					databases.set(name, database);
				}
				const nextVersion = requestedVersion ?? (database.version || 1);
				if (nextVersion < database.version) {
					failOpenRequest(request, new DOMException('The requested version is lower than the current version.', 'VersionError'));
					return;
				}
				request.result = database;
				if (nextVersion === database.version) {
					queueMicrotask(() => request.onsuccess?.(requestEvent('success', request)));
					return;
				}
				const oldVersion = database.version;
				const snapshot = snapshotDatabase(database);
				const transaction = new FakeTransaction(
					database,
					[...database.stores.keys()],
					'versionchange',
					{
						onComplete() {
							database.upgradeTransaction = null;
							request.transaction = null;
							request.onsuccess?.(requestEvent('success', request));
						},
						onAbort(error) {
							database.upgradeTransaction = null;
							request.transaction = null;
							request.error = error || new DOMException('The version change transaction was aborted.', 'AbortError');
							request.onerror?.(requestEvent('error', request));
						},
						snapshot,
					},
				);
				database.version = nextVersion;
				database.upgradeTransaction = transaction;
				request.transaction = transaction;
				try {
					request.onupgradeneeded?.({
						...requestEvent('upgradeneeded', request),
						oldVersion,
						newVersion: nextVersion,
					});
				} catch (error) {
					transaction.fail(error);
				}
			});
			return request;
		},
		failNextPutForStore(storeName, error = new Error(`Planned put failure for ${storeName}.`)) {
			pendingPutFailures.set(storeName, error);
		},
		onNextGetForStore(storeName, observer) { pendingGetObservers.set(storeName, () => { pendingGetObservers.delete(storeName); observer(); }); },
		recordCount(databaseName, storeName) {
			return databases.get(databaseName)?.stores.get(storeName)?.records.size || 0;
		},
		records(databaseName, storeName) {
			const records = databases.get(databaseName)?.stores.get(storeName)?.records;
			return [...(records?.entries() || [])]
				.sort(([left], [right]) => compareKeys(left, right))
				.map(([, value]) => clone(value));
		},
		seedRecord(databaseName, storeName, value, primaryKey) {
			const store = databases.get(databaseName)?.stores.get(storeName);
			if (!store) throw new Error(`Store ${storeName} has not been created.`);
			const stored = clone(value);
			store.records.set(primaryKey ?? stored[store.keyPath], stored);
		},
	};
}

class FakeDatabase {
	constructor(stats, takePutFailure) {
		this.stats = stats;
		this.takePutFailure = takePutFailure;
		this.version = 0;
		this.stores = new Map();
		this.upgradeTransaction = null;
		this.objectStoreNames = { contains: (name) => this.stores.has(name) };
	}
	createObjectStore(name, { keyPath }) {
		if (!this.upgradeTransaction || this.upgradeTransaction.finished) {
			throw new DOMException('Object stores can only be created during a version upgrade.', 'InvalidStateError');
		}
		if (this.stores.has(name)) throw new DOMException(`Store ${name} already exists.`, 'ConstraintError');
		const data = { name, keyPath, records: new Map(), indexes: new Map() };
		this.stores.set(name, data);
		this.upgradeTransaction.addObjectStore(name);
		return new FakeObjectStore(this.upgradeTransaction, data);
	}
	transaction(storeNames, mode = 'readonly') {
		return new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames], mode);
	}
	close() {}
}

class FakeTransaction {
	constructor(database, storeNames, mode, { onComplete, onAbort, snapshot } = {}) {
		this.database = database;
		this.storeNames = new Set(storeNames);
		this.mode = mode;
		this.onInternalComplete = onComplete;
		this.onInternalAbort = onAbort;
		this.databaseSnapshot = snapshot;
		this.recordSnapshot = mode === 'readwrite' ? snapshotRecords(database, storeNames) : null;
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

	addObjectStore(name) {
		this.storeNames.add(name);
	}

	objectStore(name) {
		if (!this.storeNames.has(name)) throw new Error(`Store ${name} is outside this transaction.`);
		const data = this.database.stores.get(name);
		if (!data) throw new DOMException(`Store ${name} does not exist.`, 'NotFoundError');
		return new FakeObjectStore(this, data);
	}

	beginRequest() {
		if (this.finished) throw new Error('The transaction is inactive.');
		this.pending += 1;
	}

	endRequest() {
		this.pending = Math.max(0, this.pending - 1);
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
			try {
				this.oncomplete?.(requestEvent('complete', this));
			} finally {
				this.onInternalComplete?.();
			}
		});
	}

	fail(error) {
		if (this.finished) return;
		const event = cancelableErrorEvent(this);
		this.onerror?.(event);
		if (!event.defaultPrevented) this.abort(error);
	}

	abort(error = null) {
		if (this.finished) return;
		this.error = error;
		if (this.databaseSnapshot) restoreDatabase(this.database, this.databaseSnapshot);
		else if (this.recordSnapshot) restoreRecords(this.database, this.recordSnapshot);
		this.finished = true;
		this.database.stats.activeTransactions -= 1;
		queueMicrotask(() => {
			try {
				this.onabort?.(requestEvent('abort', this));
			} finally {
				this.onInternalAbort?.(this.error);
			}
		});
	}
}

class FakeObjectStore {
	constructor(transaction, data) {
		this.transaction = transaction;
		this.data = data;
		this.keyPath = data.keyPath;
		this.indexNames = { contains: (name) => data.indexes.has(name) };
	}

	put(value) {
		return fakeRequest(this.transaction, () => {
			const failure = this.transaction.database.takePutFailure(this.data.name);
			if (failure) throw failure;
			const stored = clone(value);
			this.data.records.set(stored[this.data.keyPath], stored);
			return stored[this.data.keyPath];
		});
	}

	createIndex(name, keyPath) {
		if (this.data.indexes.has(name)) throw new DOMException(`Index ${name} already exists.`, 'ConstraintError');
		this.data.indexes.set(name, keyPath);
		return new FakeIndex(this.transaction, this.data, name);
	}

	get(key) {
		return fakeRequest(this.transaction, () => {
			this.transaction.database.stats.takeGetObserver(this.data.name)?.();
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
		const entries = entriesForStore(this.data, query).map(([primaryKey, value]) => ({
			key: primaryKey,
			primaryKey,
			value,
		}));
		return fakeCursorRequest(this.transaction, this.data, entries, { index: null, query });
	}

	openKeyCursor(query, direction = 'next') {
		const entries = entriesForStore(this.data, query).map(([primaryKey]) => ({
			key: primaryKey,
			primaryKey,
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
	count(query) { return fakeRequest(this.transaction, () => this.values(query).length); }
	openCursor(query) {
		const entries = this.entries(query);
		return fakeCursorRequest(this.transaction, this.data, entries, { index: this.name, query });
	}
	openKeyCursor(query) {
		const entries = this.entries(query).map(({ key, primaryKey }) => ({ key, primaryKey }));
		return fakeKeyCursorRequest(this.transaction, this.data, entries, {
			index: this.name, query, direction: 'next',
		});
	}

	values(query) {
		return this.entries(query).map(({ value }) => value);
	}

	entries(query) {
		return [...this.data.records.entries()]
			.map(([primaryKey, value]) => ({ key: value[this.keyPath], primaryKey, value }))
			.filter(({ key }) => query === undefined || key === query)
			.sort((left, right) => compareKeys(left.key, right.key)
				|| compareKeys(left.primaryKey, right.primaryKey));
	}
}

function fakeRequest(transaction, operation) {
	const request = { result: undefined, error: null, onsuccess: null, onerror: null };
	transaction.beginRequest();
	queueMicrotask(() => {
		if (transaction.finished) {
			request.error = new DOMException('The transaction was aborted.', 'AbortError');
			request.onerror?.(requestEvent('error', request));
			transaction.endRequest();
			return;
		}
		try {
			request.result = operation();
			request.onsuccess?.(requestEvent('success', request));
		} catch (error) {
			request.error = error;
			dispatchRequestError(request, transaction);
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
		if (transaction.finished) {
			request.error = new DOMException('The transaction was aborted.', 'AbortError');
			request.onerror?.(requestEvent('error', request));
			transaction.endRequest();
			return;
		}
		if (position >= entries.length) {
			request.result = null;
			request.onsuccess?.(requestEvent('success', request));
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
		request.onsuccess?.(requestEvent('success', request));
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
		if (transaction.finished) {
			request.error = new DOMException('The transaction was aborted.', 'AbortError');
			request.onerror?.(requestEvent('error', request));
			transaction.endRequest();
			return;
		}
		if (position >= entries.length) {
			request.result = null;
			request.onsuccess?.(requestEvent('success', request));
			transaction.endRequest();
			return;
		}
		const entry = entries[position];
		let continued = false;
		requestStats.delivered += 1;
		request.result = {
			key: entry.key,
			primaryKey: entry.primaryKey,
			delete() {
				data.records.delete(entry.primaryKey);
			},
			continue() {
				if (continued) throw new Error('The cursor has already advanced.');
				continued = true;
				position += 1;
				deliver();
			},
		};
		request.onsuccess?.(requestEvent('success', request));
		if (!continued) transaction.endRequest();
	});
	deliver();
	return request;
}

function entriesForStore(data, query) {
	return [...data.records.entries()]
		.filter(([primaryKey]) => query === undefined || primaryKey === query)
		.sort(([left], [right]) => compareKeys(left, right));
}

function valuesForStore(data, query) {
	return entriesForStore(data, query).map(([, value]) => value);
}

function normalizeVersion(version) {
	if (version === undefined) return undefined;
	const normalized = Number(version);
	if (!Number.isSafeInteger(normalized) || normalized <= 0) {
		throw new TypeError('IndexedDB versions must be positive integers.');
	}
	return normalized;
}

function snapshotDatabase(database) {
	return {
		version: database.version,
		stores: cloneStores(database.stores),
	};
}

function restoreDatabase(database, snapshot) {
	database.version = snapshot.version;
	database.stores = cloneStores(snapshot.stores);
}

function snapshotRecords(database, storeNames) {
	return new Map(storeNames.map((name) => {
		const store = database.stores.get(name);
		if (!store) throw new DOMException(`Store ${name} does not exist.`, 'NotFoundError');
		return [name, cloneRecords(store.records)];
	}));
}

function restoreRecords(database, snapshot) {
	for (const [name, records] of snapshot) {
		const store = database.stores.get(name);
		if (store) store.records = cloneRecords(records);
	}
}

function cloneStores(stores) {
	return new Map([...stores].map(([name, store]) => [name, {
		name: store.name,
		keyPath: store.keyPath,
		records: cloneRecords(store.records),
		indexes: new Map(store.indexes),
	}]));
}

function cloneRecords(records) {
	return new Map([...records].map(([key, value]) => [key, clone(value)]));
}

function failOpenRequest(request, error) {
	request.error = error;
	request.onerror?.(requestEvent('error', request));
}

function dispatchRequestError(request, transaction) {
	const event = cancelableErrorEvent(request);
	request.onerror?.(event);
	if (!event.propagationStopped) transaction.onerror?.(event);
	if (!event.defaultPrevented) transaction.abort(request.error);
}

function requestEvent(type, target) {
	return { type, target, currentTarget: target };
}

function cancelableErrorEvent(target) {
	return {
		...requestEvent('error', target),
		defaultPrevented: false,
		propagationStopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.propagationStopped = true; },
	};
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
