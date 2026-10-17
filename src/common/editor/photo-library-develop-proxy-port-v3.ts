/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from './imaging/image-develop-state-current-v1.ts';
import type { PixelFrameV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopProxyViewV2 } from './photo-library-develop-proxy-port-v2.ts';
import type { CubeLutSourcePortV1 } from './imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';
import type { ImageDevelopMaskOverlaySelectionV1 } from './imaging/image-develop-mask-overlay-v1.ts';

export interface PhotoLibraryDevelopFrameRequestV3 {
	readonly frame: PixelFrameV1;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly signal: AbortSignal;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
}
export type PhotoLibraryDevelopProxyViewV3 = PhotoLibraryDevelopProxyViewV2;
/** Explicit current admission with the same borrowed frame and selected resource lifetime. */
export interface PhotoLibraryDevelopProxyRuntimeV3 {
	withProxy<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>,
		consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>): Promise<Result>;
	withFullResolution<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>,
		consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>): Promise<Result>;
}
export type LoadPhotoLibraryDevelopProxyRuntimeV3 = () => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV3>>;
export type CreatePhotoLibraryDevelopProxyRuntimeV3 = (source: Readonly<CubeLutSourcePortV1>,
	maskSource?: Readonly<MaskRasterSourcePortV1>) => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV3>>;
