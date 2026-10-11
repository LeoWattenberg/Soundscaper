/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './imaging/image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopProxyViewV1 } from './photo-library-develop-proxy-port-v1.ts';
import type { CubeLutSourcePortV1 } from './imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';
import type { ImageDevelopMaskOverlaySelectionV1, ImageDevelopMaskOverlayViewV1 } from './imaging/image-develop-mask-overlay-v1.ts';

export interface PhotoLibraryDevelopFrameRequestV2 {
	readonly frame: PixelFrameV1;
	readonly develop: ImageDevelopStateV1 | ImageDevelopStateV2;
	readonly signal: AbortSignal;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
}
export interface PhotoLibraryDevelopProxyViewV2 extends PhotoLibraryDevelopProxyViewV1 {
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlayViewV1>;
}
/** Explicit current settings admission; resource custody stays in runtime composition. */
export interface PhotoLibraryDevelopProxyRuntimeV2 {
	withProxy<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV2>,
		consume: (view: PhotoLibraryDevelopProxyViewV2) => Result | Promise<Result>): Promise<Result>;
	withFullResolution<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV2>,
		consume: (view: PhotoLibraryDevelopProxyViewV2) => Result | Promise<Result>): Promise<Result>;
}
export type LoadPhotoLibraryDevelopProxyRuntimeV2 = () => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV2>>;
/** The UI generation supplies its selected library source before constructing a renderer. */
export type CreatePhotoLibraryDevelopProxyRuntimeV2 = (source: Readonly<CubeLutSourcePortV1>,
	maskSource?: Readonly<MaskRasterSourcePortV1>) => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV2>>;
