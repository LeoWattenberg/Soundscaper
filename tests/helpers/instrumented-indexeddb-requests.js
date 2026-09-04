/* SPDX-License-Identifier: AGPL-3.0-only */

import { blobPayloadStats, blobReadStats } from './instrumented-indexeddb-blob-stats.js';

/**
 * The asynchronous shapes IndexedDB hands back, faked faithfully enough to fail like one.
 *
 * A request settles on a later task, not immediately, and a cursor advances only when the
 * caller asks — so code that awaits the wrong thing or forgets to continue hangs here
 * exactly as it would in a browser. Reproducing that is the point of the fake: a store
 * that resolved synchronously would let ordering bugs pass.
 */

export function fakeRequest(transaction, operation) {
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

export function fakeGetAllRequest(transaction, data, index, query, count, values) {
	return fakeRequest(transaction, () => {
		const failure = transaction.database.takeRequestFailure('getAll', data.name);
		if (failure) throw failure;
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

export function fakeCursorRequest(transaction, data, entries, { index, query }) {
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

export function fakeKeyCursorRequest(transaction, data, entries, { index, query, direction }) {
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

function dispatchRequestError(request, transaction) {
	const event = cancelableErrorEvent(request);
	request.onerror?.(event);
	if (!event.propagationStopped) transaction.onerror?.(event);
	if (!event.defaultPrevented) transaction.abort(request.error);
}

export function requestEvent(type, target) {
	return { type, target, currentTarget: target };
}

export function compareKeys(left, right) {
	if (left === right) return 0;
	return String(left) < String(right) ? -1 : 1;
}

export function clone(value) {
	return value === undefined ? undefined : structuredClone(value);
}

export function cancelableErrorEvent(target) {
	return {
		...requestEvent('error', target),
		defaultPrevented: false,
		propagationStopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.propagationStopped = true; },
	};
}
