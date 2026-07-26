/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorMemoryDatabase } from './memory-backend.ts';

/** The backend boundary shared by domain repositories. */
export interface StorageRepositoryPort {
	readonly memory: EditorMemoryDatabase;
	database(): Promise<IDBDatabase | null>;
}
