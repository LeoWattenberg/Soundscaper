/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoLibraryWorkflowForProfileV1 } from './use-photo-library-workflow-kernel-v1.ts';
import type { CreatePhotoLibrarySessionV3 } from '../../photo-library-session-port-v2.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
export { DEFAULT_PHOTO_LIBRARY_QUERY_V1, DEFAULT_PHOTO_LIBRARY_QUERY_V2 } from '../../controller/shared/photo-library-query-navigation.ts';
export type { PhotoLibraryBackupSaveRuntimeV1, LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
export type { PhotoLibraryBatchRenameWorkflowReceiptV1 } from './use-photo-library-workflow-kernel-v1.ts';
export function usePhotoLibraryWorkflowV2(createSession?: CreatePhotoLibrarySessionV3, loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1, createDevelopProxyRuntime?: CreatePhotoLibraryDevelopProxyRuntimeV2) {
	return usePhotoLibraryWorkflowForProfileV1('legacy2', createSession, loadBackupSaveRuntime, createDevelopProxyRuntime);
}
