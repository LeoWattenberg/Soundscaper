/* SPDX-License-Identifier: AGPL-3.0-only */

export interface NativeSmartCollectionTransactionV1 {
	readonly mode: IDBTransactionMode;
	readonly phase: string;
	readonly stores: readonly string[];
	rootBytes: number;
	contextBytes: number;
	definitionBytes: number;
	summaryBytes: number;
	definitionReads: number;
	summaryDeliveries: number;
	keyDeliveries: number;
	successfulPuts: number;
}
export interface NativeSmartCollectionObserverV1 {
	phase: string;
	readonly transactions: NativeSmartCollectionTransactionV1[];
	activeTransactions: number;
	forbiddenRequests: number;
	upgradeRequests: number;
	onPut: ((store: string) => void) | null;
	onComplete: ((transaction: NativeSmartCollectionTransactionV1) => void) | null;
	settle(): Promise<void>;
	restore(): void;
}
type NativePort = IDBDatabase | IDBObjectStore | IDBIndex;
type NativeMethod = (this: NativePort, ...args: unknown[]) => unknown;
const encoder = new TextEncoder();

/** Serialized source measurement; this is deliberately not an engine/RSS claim. */
export function nativeSmartCollectionBytesV1(value: unknown): number {
	return encoder.encode(JSON.stringify(value)).byteLength;
}

/** Observes actual IndexedDB requests and joins them before restoring native prototypes. */
export function observeNativeSmartCollectionsV1(prefix: string): NativeSmartCollectionObserverV1 {
	const restores: (() => void)[] = [], pending = new Set<Promise<void>>();
	const records = new WeakMap<IDBTransaction, NativeSmartCollectionTransactionV1>();
	const observer: NativeSmartCollectionObserverV1 = { phase: 'setup', transactions: [], activeTransactions: 0,
		forbiddenRequests: 0, upgradeRequests: 0, onPut: null, onComplete: null,
		settle: async () => { await Promise.all([...pending]); },
		restore: () => { for (const restore of restores.reverse()) restore(); },
	};
	function patch(prototype: object, method: string, replacement: (original: NativeMethod) => NativeMethod): void {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
		if (!descriptor || typeof descriptor.value !== 'function') throw new TypeError(`Missing native IndexedDB method ${method}.`);
		Object.defineProperty(prototype, method, { ...descriptor, value: replacement(descriptor.value as NativeMethod) });
		restores.push(() => { Object.defineProperty(prototype, method, descriptor); });
	}
	patch(IDBDatabase.prototype, 'transaction', original => function (...args) {
		const database = this as IDBDatabase, transaction = Reflect.apply(original, database, args) as IDBTransaction;
		if (!database.name.startsWith(prefix)) return transaction;
		const record: NativeSmartCollectionTransactionV1 = { mode: transaction.mode, phase: observer.phase,
			stores: [...transaction.objectStoreNames], rootBytes: 0, contextBytes: 0, definitionBytes: 0, summaryBytes: 0,
			definitionReads: 0, summaryDeliveries: 0, keyDeliveries: 0, successfulPuts: 0 };
		records.set(transaction, record); observer.transactions.push(record); observer.activeTransactions++;
		let finish!: () => void, settled = false;
		const settlement = new Promise<void>(resolve => { finish = resolve; }); pending.add(settlement);
		const done = (): void => {
			if (settled) return;
			settled = true; observer.activeTransactions--; pending.delete(settlement); finish();
		};
		transaction.addEventListener('complete', () => { done(); observer.onComplete?.(record); }, { once: true });
		transaction.addEventListener('abort', done, { once: true });
		return transaction;
	});
	for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
		for (const method of ['get', 'getKey', 'openCursor', 'openKeyCursor', 'getAll', 'getAllKeys', 'count']) {
			patch(prototype, method, original => function (...args) {
				const port = this as IDBObjectStore | IDBIndex, store = port instanceof IDBIndex ? port.objectStore : port;
				if (!store.transaction.db.name.startsWith(prefix)) return Reflect.apply(original, port, args);
				if (['getAll', 'getAllKeys', 'count'].includes(method)) refuse('Aggregate native collection traversal.');
				if (observer.phase === 'list' && store.name === 'photoSmartCollections' && (method === 'get' || method === 'openCursor')) {
					refuse('Summary paging loaded a full saved query.');
				}
				if (observer.phase !== 'setup' && observer.phase !== 'inspect'
					&& ['photos', 'summaries', 'photoQueryRows', 'photoQueryRowsV2'].includes(store.name)) {
					refuse('Saved-query authority read a photo or derived photo body.');
				}
				if (observer.phase === 'upgrade') observer.upgradeRequests++;
				const request = Reflect.apply(original, port, args) as IDBRequest<unknown>;
				request.addEventListener('success', () => {
					const value = request.result, record = records.get(store.transaction);
					if (!record || value === null || value === undefined) return;
					if (method === 'openKeyCursor') { record.keyDeliveries++; return; }
					const source: unknown = value instanceof IDBCursorWithValue ? value.value : value;
					if (method !== 'get' && method !== 'openCursor') return;
					if (store.name === 'catalogs') record.rootBytes += nativeSmartCollectionBytesV1(source);
					if (store.name === 'catalogStates' || store.name === 'photoSmartCollectionStates') record.contextBytes += nativeSmartCollectionBytesV1(source);
					if (store.name === 'photoSmartCollections') { record.definitionBytes += nativeSmartCollectionBytesV1(source); record.definitionReads++; }
					if (store.name === 'photoSmartCollectionSummaries') { record.summaryBytes += nativeSmartCollectionBytesV1(source); record.summaryDeliveries++; }
				});
				return request;
			});
		}
	}
	for (const method of ['put', 'add', 'delete', 'clear']) {
		patch(IDBObjectStore.prototype, method, original => function (...args) {
			const store = this as IDBObjectStore, request = Reflect.apply(original, store, args) as IDBRequest<unknown>;
			if (store.transaction.db.name.startsWith(prefix)) {
				if (observer.phase === 'upgrade') observer.upgradeRequests++;
				if (method === 'put') request.addEventListener('success', () => {
					const record = records.get(store.transaction); if (record) record.successfulPuts++;
					observer.onPut?.(store.name);
				}, { once: true });
			}
			return request;
		});
	}
	return observer;
	function refuse(message: string): never { observer.forbiddenRequests++; throw new Error(message); }
}

export async function nativeSmartCollectionTransactionV1(database: IDBDatabase, names: readonly string[], mode: IDBTransactionMode,
	operation: (stores: Readonly<Record<string, IDBObjectStore>>) => void): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction([...names], mode);
		transaction.addEventListener('complete', () => resolve(), { once: true });
		transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Native fixture transaction aborted.')), { once: true });
		try { operation(Object.fromEntries(names.map(name => [name, transaction.objectStore(name)]))); }
		catch (error) { transaction.abort(); reject(error); }
	});
}

export async function nativeSmartCollectionPointV1(database: IDBDatabase, name: string, key: IDBValidKey): Promise<unknown> {
	let value: unknown;
	await nativeSmartCollectionTransactionV1(database, [name], 'readonly', stores => {
		const request = stores[name]!.get(key) as IDBRequest<unknown>;
		request.addEventListener('success', () => { value = request.result; }, { once: true });
	});
	return value;
}

export async function nativeSmartCollectionFingerprintV1(database: IDBDatabase, names: readonly string[]): Promise<string> {
	const rows: unknown[] = [];
	await nativeSmartCollectionTransactionV1(database, names, 'readonly', stores => {
		for (const name of names) {
			const request = stores[name]!.openCursor();
			request.addEventListener('success', () => {
				const cursor = request.result;
				if (cursor) { rows.push([name, cursor.primaryKey, cursor.value as unknown]); cursor.continue(); }
			});
		}
	});
	// Cross-store delivery order is not part of IndexedDB's storage identity.
	const documents = rows.map(value => JSON.stringify(value)).sort();
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(documents)));
	return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
