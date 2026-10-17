/* SPDX-License-Identifier: AGPL-3.0-only */

export const LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1 = Object.freeze({
	maximumRowsPerTransaction: 4_000,
	maximumTransactionBytes: 8 * 1024 * 1024,
});
interface SeedRecord { readonly storeName: string; readonly value: unknown }
interface SeedResult {
	rows: number; batches: number; maximumBatchRows: number; maximumBatchBytes: number;
	constructMilliseconds: number; enqueueMilliseconds: number; transactionMilliseconds: number;
}
interface SeedOptions {
	storeNames: readonly string[]; totalRows: number;
	createRecords: (index: number) => readonly SeedRecord[];
	onProgress?: (result: Readonly<SeedResult>) => void;
}
const pending = new WeakSet<object>();
const encoder = new TextEncoder();
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** Test fixture payload accounting, not a bound on browser heap or native storage overhead. */
function recordBytes(value: unknown): number {
	const json = JSON.stringify(value);
	if (json === undefined) throw new TypeError('Seed records must have JSON metadata.');
	const blob = value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'blob') : undefined;
	return encoder.encode(json).byteLength + (blob && 'value' in blob && blob.value !== undefined
		? Reflect.apply(blobSize, blob.value, []) as number : 0);
}

/** 4,000 logical groups: at most 12,000 physical puts; no queue or inline Blob body reads. */
export async function seedLightscaperNativeScaleV1(database: Pick<IDBDatabase, 'transaction'>, options: SeedOptions): Promise<Readonly<SeedResult>> {
	if (pending.has(database)) throw new Error('A native scale seed is pending.');
	pending.add(database);
	try {
		const storeNames = [...options.storeNames], totalRows = options.totalRows;
		const createRecords = options.createRecords, onProgress = options.onProgress;
		if (storeNames.length < 1 || storeNames.length > 3 || new Set(storeNames).size !== storeNames.length
			|| storeNames.some(name => typeof name !== 'string' || !name || name.length > 128)
			|| !Number.isSafeInteger(totalRows) || totalRows < 1 || totalRows > 100_000 || typeof createRecords !== 'function'
			|| (onProgress !== undefined && typeof onProgress !== 'function')) throw new TypeError('Invalid bounded native scale seed.');
		const transactionPort = database.transaction.bind(database);
		const result: SeedResult = { rows: 0, batches: 0, maximumBatchRows: 0, maximumBatchBytes: 0,
			constructMilliseconds: 0, enqueueMilliseconds: 0, transactionMilliseconds: 0 };
		for (let start = 0; start < totalRows; start += LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1.maximumRowsPerTransaction) {
			const began = performance.now(), end = Math.min(totalRows, start + LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1.maximumRowsPerTransaction);
			const transaction = transactionPort(storeNames, 'readwrite');
			const completion = new Promise<void>((resolve, reject) => {
				transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
			});
			void completion.catch(() => undefined);
			let bytes = 0, failed = false, failure: unknown;
			try {
				const stores = new Map(storeNames.map(name => [name, transaction.objectStore(name)]));
				for (let index = start; index < end; index++) {
					const constructing = performance.now(), records = createRecords(index);
					if (!Array.isArray(records) || records.length !== storeNames.length) throw new TypeError('Seed row must fill its declared stores.');
					const seen = new Set<string>();
					for (const record of records) {
						if (!stores.has(record.storeName) || seen.has(record.storeName)) throw new TypeError('Invalid seed record store.');
						seen.add(record.storeName); bytes += recordBytes(record.value);
					}
					if (bytes > LIGHTSCAPER_NATIVE_SCALE_SEED_LIMITS_V1.maximumTransactionBytes) throw new RangeError('Native scale seed byte bound exceeded.');
					result.constructMilliseconds += performance.now() - constructing;
					const enqueuing = performance.now();
					for (const record of records) stores.get(record.storeName)!.put(record.value);
					result.enqueueMilliseconds += performance.now() - enqueuing;
				}
				transaction.commit();
			} catch (error) {
				failed = true; failure = error;
				try { transaction.abort(); } catch { /* Native settlement remains the join. */ }
			}
			try { await completion; } catch (error) { if (!failed) throw error; }
			if (failed) throw failure;
			result.rows = end; result.batches++; result.maximumBatchRows = Math.max(result.maximumBatchRows, end - start);
			result.maximumBatchBytes = Math.max(result.maximumBatchBytes, bytes); result.transactionMilliseconds += performance.now() - began;
			if (end % 20_000 === 0 || end === totalRows) onProgress?.(Object.freeze({ ...result }));
		}
		return Object.freeze(result);
	} finally { pending.delete(database); }
}

/** Post-seed physical proof: counts, exact native geometry and at most two point samples per store. */
export async function inspectLightscaperNativeScaleV1(database: IDBDatabase, samples: Readonly<Record<string, readonly IDBValidKey[]>>) {
	const transaction = database.transaction(Object.keys(samples));
	const completion = new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
	});
	void completion.catch(() => undefined);
	function read<Result>(request: IDBRequest<Result>): Promise<Result> {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
	}
	try {
		const inspections = Object.entries(samples).map(async ([name, keys]) => {
			if (keys.length > 2) throw new RangeError('Scale inspection has at most two point samples.');
			const store = transaction.objectStore(name);
			const indexes = [...store.indexNames].map(indexName => {
				const index = store.index(indexName);
				return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
			});
			const count = read(store.count()), values = keys.map(key => read<unknown>(store.get(key)));
			return [name, { count: await count, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes,
				values: await Promise.all(values) }] as const;
		});
		const results = await Promise.all(inspections); await completion;
		return Object.fromEntries(results);
	} catch (error) {
		try { transaction.abort(); } catch { /* Join the original native completion. */ }
		try { await completion; } catch { /* Preserve the inspection failure. */ }
		throw error;
	}
}
