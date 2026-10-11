/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperAppKernelV1 from './LightscaperAppKernelV1.tsx';
import type { CreatePhotoLibrarySessionV3 } from '../../photo-library-session-port-v2.ts';
import type { LoadPhotoLibraryRestoreRuntimeV1 } from '../../photo-library-restore-port-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { LoadPhotoMetadataQueryRuntimeV2 } from '../../photo-library-query-port-v2.ts';
import type { LoadPhotoSavedFilterRuntimeV1 } from '../../photo-library-saved-filter-runtime-v1.ts';
export interface LightscaperAppPropsV2 {
	readonly locale: string;
	readonly createSession?: CreatePhotoLibrarySessionV3;
	readonly loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1;
	readonly loadMetadataQueryRuntime?: LoadPhotoMetadataQueryRuntimeV2;
	readonly loadSavedFilterRuntime?: LoadPhotoSavedFilterRuntimeV1;
	readonly loadRestoreRuntime?: LoadPhotoLibraryRestoreRuntimeV1;
	readonly loadDevelopProxyRuntime?: CreatePhotoLibraryDevelopProxyRuntimeV2;
}

export default function LightscaperAppV2(props: LightscaperAppPropsV2) { return <LightscaperAppKernelV1 {...props} profile="legacy2" />; }
