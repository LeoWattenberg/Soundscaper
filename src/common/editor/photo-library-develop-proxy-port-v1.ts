/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { PixelFrameHistogramV1 } from './imaging/pixel-frame-histogram-v1.ts';
import type { PhotoLibraryDevelopSettingsV1 } from './photo-library-develop-port-v1.ts';

export interface PhotoLibraryDevelopProxyViewV1 {
	readonly frame: Readonly<PixelFrameV1>;
	readonly histogram: Readonly<PixelFrameHistogramV1>;
}
/** A scoped derivative, never an original body or catalog owner. */
export interface PhotoLibraryDevelopProxyRuntimeV1 {
	withFullResolution?<Result>(request: Readonly<{ frame: PixelFrameV1; develop: PhotoLibraryDevelopSettingsV1; signal: AbortSignal }>,
		consume: (view: PhotoLibraryDevelopProxyViewV1) => Result | Promise<Result>): Promise<Result>;
	withProxy<Result>(request: Readonly<{ frame: PixelFrameV1; develop: PhotoLibraryDevelopSettingsV1; signal: AbortSignal }>,
		consume: (view: PhotoLibraryDevelopProxyViewV1) => Result | Promise<Result>): Promise<Result>;
}
export type LoadPhotoLibraryDevelopProxyRuntimeV1 = () => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV1>>;
