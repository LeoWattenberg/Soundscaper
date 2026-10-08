/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBrowserFileSaveService } from '../common/editor/browser-file-save-service.ts';
import { maximumPhotoCatalogStreamingOutputBytesV1 } from './archive/catalog-archive-capacity.ts';

/** File-menu opt-in composition. Catalog authority stays with the existing session. */
export function createPhotoLibraryBackupSaveRuntimeV1() {
	const files = createBrowserFileSaveService();
	return Object.freeze({ prepareSave: files.prepareSave, saveFile: files.saveFile,
		maximumStreamingBytes: maximumPhotoCatalogStreamingOutputBytesV1() });
}
