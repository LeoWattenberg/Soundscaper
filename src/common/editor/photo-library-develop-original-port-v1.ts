/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1 } from './imaging/pixel-frame-contract-v1.ts';

export interface PhotoLibraryDevelopOriginalReadV1 {
	readonly schemaVersion: 1;
	readonly photoId: string;
	readonly expectedRevision: number;
}

/** Oriented pixels are borrowed only while the consumer runs; original locators and bodies stay product-owned. */
export interface PhotoLibraryDevelopOriginalFrameV1 {
	readonly photoId: string;
	readonly revision: number;
	readonly frame: Readonly<PixelFrameV1>;
}

export interface PhotoLibraryDevelopOriginalPortV1 {
	withFrame<Result>(request: PhotoLibraryDevelopOriginalReadV1,
		consume: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
