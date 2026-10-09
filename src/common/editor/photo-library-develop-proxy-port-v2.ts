/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './imaging/image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopProxyViewV1 } from './photo-library-develop-proxy-port-v1.ts';

export interface PhotoLibraryDevelopFrameRequestV2 {
	readonly frame: PixelFrameV1;
	readonly develop: ImageDevelopStateV1 | ImageDevelopStateV2;
	readonly signal: AbortSignal;
}
/** Explicit current settings admission; resource custody stays in runtime composition. */
export interface PhotoLibraryDevelopProxyRuntimeV2 {
	withProxy<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV2>,
		consume: (view: PhotoLibraryDevelopProxyViewV1) => Result | Promise<Result>): Promise<Result>;
	withFullResolution<Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV2>,
		consume: (view: PhotoLibraryDevelopProxyViewV1) => Result | Promise<Result>): Promise<Result>;
}
export type LoadPhotoLibraryDevelopProxyRuntimeV2 = () => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV2>>;
