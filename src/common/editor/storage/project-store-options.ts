/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRepositoryFactory, StorageRepositoryOptions } from './repositories.ts';

/** Constructor-time capabilities for the existing project store plus one opaque profile token. */
export interface AudioEditorProjectStoreOptions {
	readonly indexedDB?: IDBFactory | null;
	readonly databaseName?: string;
	readonly projectStorageProfile?: unknown;
	readonly memoryFallback?: boolean;
	readonly storageManager?: StorageManager | null;
	readonly opfsRoot?: FileSystemDirectoryHandle | null;
	readonly preferOpfs?: boolean;
	readonly revisionLimit?: number;
	readonly maximumProjectDocumentBytes?: number;
	readonly pcmCodec?: StorageRepositoryOptions['pcmCodec'];
	readonly pcmCodecFactory?: StorageRepositoryOptions['pcmCodecFactory'];
	readonly derivativeCacheLimits?: StorageRepositoryOptions['derivativeCacheLimits'];
	readonly derivativeCacheNow?: StorageRepositoryOptions['derivativeCacheNow'];
	readonly linkedOriginalPort?: StorageRepositoryOptions['linkedOriginalPort'];
	readonly linkedVideoOriginalPort?: StorageRepositoryOptions['linkedVideoOriginalPort'];
	readonly onLinkedVideoOriginalLocatorCleanupError?: (error: unknown) => void;
	readonly repositoryFactory?: StorageRepositoryFactory;
}
