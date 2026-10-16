/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopPreviewKernelV1 from './PhotoDevelopPreviewKernelV1.tsx';
import type { PhotoDevelopPreviewPropsV2 } from './PhotoDevelopPreviewV2.tsx';
import type { PhotoLibraryDevelopSettingsCurrentV1 } from '../../photo-library-develop-port-current-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../../photo-library-develop-original-current-v1.ts';
import type { ImageOutputSoftProofCurrentV1 } from '../../imaging/image-output-soft-proof-current-v1.ts';
import type { PhotoDevelopPreviewRendererCurrentV1 } from '../../photo-library-develop-gpu-preview-port-current-v1.ts';
export interface PhotoDevelopPreviewPropsCurrentV1 extends Omit<PhotoDevelopPreviewPropsV2, 'develop' | 'loadProxy'> {
	readonly develop: PhotoLibraryDevelopSettingsCurrentV1;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeCurrentV1;
	readonly withDerivedFrame?: PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame'];
	readonly softProof?: Readonly<ImageOutputSoftProofCurrentV1>;
	readonly previewRenderer?: PhotoDevelopPreviewRendererCurrentV1;
}
export default function PhotoDevelopPreviewCurrentV1(props: PhotoDevelopPreviewPropsCurrentV1) { return <PhotoDevelopPreviewKernelV1 props={props} profile="current3" />; }
