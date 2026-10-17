/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopWorkspaceKernelV1 from './PhotoDevelopWorkspaceKernelV1.tsx';
import type { usePhotoDevelopSettingsV2 } from './use-photo-develop-settings-v2.ts';
import type { usePhotoDevelopSettingsCurrentV1 } from './use-photo-develop-settings-current-v1.ts';
import type { PhotoDevelopWorkspacePropsV2 } from './PhotoDevelopWorkspaceV2.tsx';
import type { LoadPhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../../photo-library-develop-original-current-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';

export interface PhotoDevelopWorkspacePropsCurrentV1 extends Omit<PhotoDevelopWorkspacePropsV2, 'execute' | 'settings' | 'loadProxy'> {
	readonly execute: ExecutePhotoDevelopCurrentV1;
	readonly executeLegacyDevelop?: ExecutePhotoDevelopV2;
	readonly legacySettings?: ReturnType<typeof usePhotoDevelopSettingsV2>;
	readonly settingsCurrent?: ReturnType<typeof usePhotoDevelopSettingsCurrentV1>;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeCurrentV1;
	readonly withDerivedFrame?: PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame'];
}
export default function PhotoDevelopWorkspaceCurrentV1(props: PhotoDevelopWorkspacePropsCurrentV1) {
	return <PhotoDevelopWorkspaceKernelV1 {...props} profile="current3" />;
}
