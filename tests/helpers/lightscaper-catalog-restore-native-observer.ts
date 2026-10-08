/* SPDX-License-Identifier: AGPL-3.0-only */

export interface NativeCatalogRestoreObserverV1 {
	activeTransactions: number;
	forbiddenRequests: number;
	maximumKeyDeliveries: number;
	maximumCountRequests: number;
	onRead: ((store: string) => void) | null;
	onReadinessComplete: (() => void) | null;
	settle(): Promise<void>;
	restore(): void;
}
type Port = IDBDatabase | IDBObjectStore | IDBIndex;
type Method = (this: Port, ...args: unknown[]) => unknown;

/** Native requests delegate unchanged; observations retain counters and transaction lifetimes. */
export function observeNativeCatalogRestoreV1(prefix: string): NativeCatalogRestoreObserverV1 {
	const restores: (() => void)[] = [], pending = new Set<Promise<void>>();
	const keyCounts = new WeakMap<IDBRequest<unknown>, number>(), countRequests = new WeakMap<IDBTransaction, number>();
	const readiness = new WeakSet<IDBTransaction>();
	const observer: NativeCatalogRestoreObserverV1 = { activeTransactions: 0, forbiddenRequests: 0, maximumKeyDeliveries: 0, maximumCountRequests: 0,
		onRead: null, onReadinessComplete: null, settle: async () => { await Promise.all([...pending]); },
		restore: () => { for (const restore of restores.reverse()) restore(); } };
	function patch(prototype: object, name: string, replacement: (original: Method) => Method): void {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
		if (!descriptor || typeof descriptor.value !== 'function') throw new TypeError(`Missing native restore method ${name}.`);
		Object.defineProperty(prototype, name, { ...descriptor, value: replacement(descriptor.value as Method) });
		restores.push(() => { Object.defineProperty(prototype, name, descriptor); });
	}
	patch(IDBDatabase.prototype, 'transaction', original => function (...args) {
		const database = this as IDBDatabase, transaction = Reflect.apply(original, database, args) as IDBTransaction;
		if (!database.name.startsWith(prefix)) return transaction;
		observer.activeTransactions++; let done!: () => void, settled = false;
		const settlement = new Promise<void>(resolve => { done = resolve; }); pending.add(settlement);
		const finish = (): void => {
			if (settled) return;
			settled = true; observer.activeTransactions--; pending.delete(settlement); done();
		};
		transaction.addEventListener('complete', () => { finish(); if (readiness.has(transaction)) observer.onReadinessComplete?.(); }, { once: true });
		transaction.addEventListener('abort', finish, { once: true });
		return transaction;
	});
	for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
		for (const method of ['get', 'getKey', 'openCursor', 'openKeyCursor', 'getAll', 'getAllKeys', 'count']) {
			patch(prototype, method, original => function (...args) {
				const port = this as IDBObjectStore | IDBIndex, store = port instanceof IDBIndex ? port.objectStore : port;
				if (!store.transaction.db.name.startsWith(prefix)) return Reflect.apply(original, port, args);
				const countFence = method === 'count' && store.transaction.mode === 'readwrite' && store.transaction.objectStoreNames.length === 15;
				if (['getAll', 'getAllKeys'].includes(method) || (method === 'count' && !countFence)) {
					observer.forbiddenRequests++; throw new Error('Restore requested an aggregate inventory.');
				}
				if (countFence) {
					const count = (countRequests.get(store.transaction) ?? 0) + 1; countRequests.set(store.transaction, count);
					observer.maximumCountRequests = Math.max(observer.maximumCountRequests, count);
				}
				const result = Reflect.apply(original, port, args) as IDBRequest<unknown>;
				result.addEventListener('success', () => {
					if (method === 'openKeyCursor' && result.result !== null) {
						const count = (keyCounts.get(result) ?? 0) + 1; keyCounts.set(result, count);
						observer.maximumKeyDeliveries = Math.max(observer.maximumKeyDeliveries, count);
					}
					if (method === 'get') observer.onRead?.(store.name);
				});
				return result;
			});
		}
	}
	patch(IDBObjectStore.prototype, 'put', original => function (...args) {
		const store = this as IDBObjectStore;
		if (store.transaction.db.name.startsWith(prefix) && store.name === 'photoQueryBuildStatesV2') {
			const value = args[0];
			if (value !== null && typeof value === 'object' && 'ready' in value && value.ready === true) readiness.add(store.transaction);
		}
		return Reflect.apply(original, store, args);
	});
	return observer;
}
