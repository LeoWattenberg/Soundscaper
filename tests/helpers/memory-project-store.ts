/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';

import { createProjectStore } from '../../src/common/editor/storage.js';

export type MemoryProjectStore = ReturnType<typeof createProjectStore>;

export function createMemoryProjectStore(
	context: Pick<TestContext, 'after'>,
	label: string,
): MemoryProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}
