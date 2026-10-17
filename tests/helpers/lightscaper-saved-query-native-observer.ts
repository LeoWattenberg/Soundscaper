/* SPDX-License-Identifier: AGPL-3.0-only */

export interface NativeSavedQueryMeasurementV1 {
	readonly transactions: Readonly<{ mode: IDBTransactionMode; stores: readonly string[] }>[];
	transactionCount: number;
	rowRequests: number;
	rowPointRequests: number;
	rowDeliveries: number;
	auditKeyDeliveries: number;
	emptySeeks: number;
	definitionReads: number;
	writeAttempts: number;
}
export interface NativeSavedQueryObserverV1 {
	activeTransactions: number;
	forbiddenRequests: number;
	onRead: ((store: string, method: string, key: unknown) => void) | null;
	onComplete: (() => void) | null;
	measure<T>(operation: () => Promise<T>): Promise<Readonly<{ value: T; measurement: NativeSavedQueryMeasurementV1 }>>;
	settle(): Promise<void>;
	restore(): void;
}
type NativePort = IDBDatabase | IDBObjectStore | IDBIndex;
type NativeMethod = (this: NativePort, ...args: unknown[]) => unknown;

/** Delegates native requests unchanged. Retains scalar counters, never delivered documents or cursor values. */
export function observeNativeSavedQueryExecutionV1(prefix: string): NativeSavedQueryObserverV1 {
	const restores: (() => void)[] = [], pending = new Set<Promise<void>>();
	const records = new WeakMap<IDBTransaction, NativeSavedQueryMeasurementV1>();
	let current: NativeSavedQueryMeasurementV1 | null = null;
	const observer: NativeSavedQueryObserverV1 = { activeTransactions: 0, forbiddenRequests: 0, onRead: null, onComplete: null,
		measure: async operation => {
			if (current !== null) throw new Error('Native saved-query observations cannot overlap.');
			const measurement: NativeSavedQueryMeasurementV1 = { transactions: [], transactionCount: 0, rowRequests: 0, rowPointRequests: 0,
				rowDeliveries: 0, auditKeyDeliveries: 0, emptySeeks: 0, definitionReads: 0, writeAttempts: 0 };
			current = measurement;
			try { return { value: await operation(), measurement }; }
			finally { await observer.settle(); current = null; }
		},
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
		const measurement = current;
		if (measurement !== null) {
			measurement.transactionCount++;
			if (measurement.transactions.length < 2) measurement.transactions.push({ mode: transaction.mode, stores: [...transaction.objectStoreNames] });
			records.set(transaction, measurement);
		}
		observer.activeTransactions++;
		let finish!: () => void, settled = false;
		const settlement = new Promise<void>(resolve => { finish = resolve; }); pending.add(settlement);
		const done = (): void => {
			if (settled) return;
			settled = true; observer.activeTransactions--; pending.delete(settlement); finish();
		};
		transaction.addEventListener('complete', () => { done(); if (measurement !== null) observer.onComplete?.(); }, { once: true });
		transaction.addEventListener('abort', done, { once: true });
		return transaction;
	});
	for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
		for (const method of ['get', 'getKey', 'openCursor', 'openKeyCursor', 'getAll', 'getAllKeys', 'count']) {
			patch(prototype, method, original => function (...args) {
				const port = this as IDBObjectStore | IDBIndex, store = port instanceof IDBIndex ? port.objectStore : port;
				if (!store.transaction.db.name.startsWith(prefix)) return Reflect.apply(original, port, args);
				if (['getAll', 'getAllKeys', 'count'].includes(method)) refuse('Aggregate native saved-query traversal.');
				const measurement = records.get(store.transaction);
				if (measurement && ['photos', 'summaries', 'memberships', 'photoQueryRows'].includes(store.name)) {
					refuse('Saved execution loaded a canonical photo or a legacy browse profile.');
				}
				if (measurement && store.name === 'photoQueryRowsV2' && (method === 'get' || method === 'openCursor')) {
					measurement.rowRequests++; if (method === 'get') measurement.rowPointRequests++;
				}
				const request = Reflect.apply(original, port, args) as IDBRequest<unknown>;
				if (measurement) request.addEventListener('success', () => {
					const value = request.result;
					if (store.name === 'photoQueryRowsV2' && (method === 'get' || method === 'openCursor')) {
						if (value !== null && value !== undefined) measurement.rowDeliveries++;
						else if (method === 'openCursor') measurement.emptySeeks++;
					}
					if (store.name === 'photoStacks' && method === 'openKeyCursor' && value !== null) measurement.auditKeyDeliveries++;
					if (store.name === 'photoSmartCollections' && method === 'get' && value !== undefined) measurement.definitionReads++;
					observer.onRead?.(store.name, method, args[0]);
				});
				return request;
			});
		}
	}
	for (const method of ['put', 'add', 'delete', 'clear']) {
		patch(IDBObjectStore.prototype, method, original => function (...args) {
			const store = this as IDBObjectStore, measurement = records.get(store.transaction);
			if (measurement) measurement.writeAttempts++;
			return Reflect.apply(original, store, args);
		});
	}
	return observer;
	function refuse(message: string): never { observer.forbiddenRequests++; throw new Error(message); }
}
