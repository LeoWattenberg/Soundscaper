/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelPreviewPresentationReaderV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { ImageDevelopMaskOverlaySelectionV1 } from '../../imaging/image-develop-mask-overlay-v1.ts';
import type { PhotoDevelopMaskDisplayModeV1 } from '../../photo-develop-mask-display-v1.ts';
import type { PhotoDevelopCopyV1 } from '../../../i18n/lightscaper-develop-copy.ts';
import PhotoDevelopPreviewKernelV1 from './PhotoDevelopPreviewKernelV1.tsx';

export interface PhotoDevelopPreviewPropsV2 {
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly withOriginalFrame?: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly resolution?: PhotoDevelopResolutionV1;
	readonly revision?: number;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly beforePresent: Promise<void>;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
	readonly messages: PhotoDevelopCopyV1;
	readonly locale: string;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
	readonly maskOverlayMode?: PhotoDevelopMaskDisplayModeV1;
	readonly suspended?: boolean;
	readonly isCurrent?: () => boolean;
}
/** Fixed legacy presentation keeps its preview-cache route and strict recipes. */
export default function PhotoDevelopPreviewV2(props: PhotoDevelopPreviewPropsV2) { return <PhotoDevelopPreviewKernelV1 props={props} profile="legacy2" />; }
