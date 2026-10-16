/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CreatePhotoLibrarySessionV3 } from '../../photo-library-session-port-v2.ts';
import type { CreatePhotoLibrarySessionCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import { usePhotoLibraryWorkflowForProfileV1, type PhotoLibraryWorkflowLegacyV2, type PhotoLibraryWorkflowCurrentV1 } from './use-photo-library-workflow-kernel-v1.ts';

type WorkflowHook = (profile: 'legacy2' | 'current3', createSession?: CreatePhotoLibrarySessionV3 | CreatePhotoLibrarySessionCurrentV1,
	loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1, renderer?: CreatePhotoLibraryDevelopProxyRuntimeV2 | CreatePhotoLibraryDevelopProxyRuntimeV3) => PhotoLibraryWorkflowLegacyV2 | PhotoLibraryWorkflowCurrentV1;

/** The application already admits its matching profile/factory pair. Keep
 * that composition cast separate from the menu and presentation surface. */
export const useLightscaperAppWorkflow = usePhotoLibraryWorkflowForProfileV1 as WorkflowHook;
