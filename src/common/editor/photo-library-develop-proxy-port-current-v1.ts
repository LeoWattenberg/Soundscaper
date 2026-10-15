/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateThroughV4 } from './imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopFrameRequestV3, PhotoLibraryDevelopProxyViewV3 } from './photo-library-develop-proxy-port-v3.ts';
import type { CubeLutSourcePortV1 } from './imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';

export interface PhotoLibraryDevelopFrameRequestCurrentV1 extends Omit<PhotoLibraryDevelopFrameRequestV3, 'develop'> {
	readonly develop: ImageDevelopStateThroughV4;
}
/** Source-processing admission is explicit. Permanent V3 continues to accept
 * recipes only through process3, even when a Current loader is also present. */
export interface PhotoLibraryDevelopProxyRuntimeCurrentV1 {
	withProxy<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestCurrentV1>,
		consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>): Promise<Result>;
	withFullResolution<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestCurrentV1>,
		consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>): Promise<Result>;
}
export type LoadPhotoLibraryDevelopProxyRuntimeCurrentV1 = () => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeCurrentV1>>;
export type CreatePhotoLibraryDevelopProxyRuntimeCurrentV1 = (source: Readonly<CubeLutSourcePortV1>,
	maskSource?: Readonly<MaskRasterSourcePortV1>) => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeCurrentV1>>;
