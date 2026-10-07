/* SPDX-License-Identifier: AGPL-3.0-only */

import { transact } from '../../common/editor/storage/indexeddb-backend.ts';

export function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Catalog operation was canceled.', 'AbortError');
}

export async function catalogTransaction<Result>(
	database: IDBDatabase,
	stores: readonly string[],
	mode: IDBTransactionMode,
	operation: (stores: Readonly<Record<string, IDBObjectStore>>) => Promise<Result>,
	signal?: AbortSignal,
): Promise<Result> {
	assertNotAborted(signal);
	let active: IDBTransaction | undefined;
	const abort = (): void => { try { active?.abort(); } catch { /* A completed transaction is already closed. */ } };
	signal?.addEventListener('abort', abort, { once: true });
	try {
		return await transact(database, stores, mode, (stores, transaction) => {
			active = transaction;
			assertNotAborted(signal);
			return operation(stores);
		});
	} catch (error) {
		assertNotAborted(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}
