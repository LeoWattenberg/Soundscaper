/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopImportPortCurrentV1 } from '../../common/editor/photo-library-develop-import-port-current-v1.ts';
import { createPhotoLibrarySessionImportCurrentV1, type PhotoLibrarySessionImportHostCurrentV1 } from './photo-library-session-import-current-v1.ts';
import { createPhotoLibraryDevelopImportSessionCurrentV1 } from './photo-library-develop-import-session-current-v1.ts';

export interface PhotoLibrarySessionImportChildHostCurrentV1 extends PhotoLibrarySessionImportHostCurrentV1 {
	ready(): Promise<string>;
	operation<Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result>;
}

/** Borrow the selected Current native ports and parent's writer. No separate
 * storage owner, lease, queue or cleanup lifetime is created here. */
export function createPhotoLibrarySessionImportChildCurrentV1(host: PhotoLibrarySessionImportChildHostCurrentV1): Readonly<PhotoLibraryDevelopImportPortCurrentV1> {
	const { ports, managed, presetSettings } = host, ready = host.ready.bind(host), operation = host.operation.bind(host);
	const mutate = host.mutate.bind(host), resetReady = host.resetReady.bind(host);
	const importFiles = createPhotoLibrarySessionImportCurrentV1({ ports, managed, presetSettings, mutate, resetReady });
	return createPhotoLibraryDevelopImportSessionCurrentV1({ settings: presetSettings, ready, operation, importFiles });
}
