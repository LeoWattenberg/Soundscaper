/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopPreviewKernelV1 from './PhotoDevelopPreviewKernelV1.tsx';
import type { PhotoDevelopPreviewPropsV2 } from './PhotoDevelopPreviewV2.tsx';
import type { PhotoLibraryDevelopSettingsV3 } from '../../photo-library-develop-port-v3.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
export interface PhotoDevelopPreviewPropsCurrentV1 extends Omit<PhotoDevelopPreviewPropsV2, 'develop' | 'loadProxy'> {
	readonly develop: PhotoLibraryDevelopSettingsV3;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV3;
}
export default function PhotoDevelopPreviewCurrentV1(props: PhotoDevelopPreviewPropsCurrentV1) { return <PhotoDevelopPreviewKernelV1 props={props} profile="current3" />; }
