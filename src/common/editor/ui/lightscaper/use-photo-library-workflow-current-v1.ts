/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from './use-photo-library-workflow-v2.ts';
import type { CreatePhotoLibrarySessionCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../photo-library-develop-proxy-port-current-v1.ts';

export type { PhotoLibraryWorkflowCurrentV1 } from './use-photo-library-workflow-kernel-v1.ts';
import { usePhotoLibraryWorkflowForProfileV1 } from './use-photo-library-workflow-kernel-v1.ts';
export function usePhotoLibraryWorkflowCurrentV1(createSession?: CreatePhotoLibrarySessionCurrentV1,
	loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1, createDevelopProxyRuntime?: CreatePhotoLibraryDevelopProxyRuntimeCurrentV1) {
	return usePhotoLibraryWorkflowForProfileV1('current3', createSession, loadBackupSaveRuntime, createDevelopProxyRuntime);
}
