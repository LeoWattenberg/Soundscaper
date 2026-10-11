/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopWorkspaceKernelV1 from './PhotoDevelopWorkspaceKernelV1.tsx';
import type { usePhotoDevelopSettingsV2 } from './use-photo-develop-settings-v2.ts';
import type { PhotoDevelopWorkspacePropsV2 } from './PhotoDevelopWorkspaceV2.tsx';
import type { LoadPhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';

export interface PhotoDevelopWorkspacePropsCurrentV1 extends Omit<PhotoDevelopWorkspacePropsV2, 'execute' | 'settings' | 'loadProxy'> {
	readonly execute: ExecutePhotoDevelopCurrentV1;
	readonly executeLegacyDevelop?: ExecutePhotoDevelopV2;
	readonly legacySettings?: ReturnType<typeof usePhotoDevelopSettingsV2>;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV3;
}
export default function PhotoDevelopWorkspaceCurrentV1(props: PhotoDevelopWorkspacePropsCurrentV1) {
	return <PhotoDevelopWorkspaceKernelV1 {...props} profile="current3" />;
}
