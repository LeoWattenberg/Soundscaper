/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoLibraryDevelopPresentationKernelV1, preparePhotoDevelopPresentationViewForProfileV1 } from './internal/photo-library-develop-presentation-kernel-v1.ts';
import type { PhotoLibraryDevelopSettingsV3 } from '../../photo-library-develop-port-v3.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { PixelPreviewPresentationReaderV1 } from './pixel-preview-presentation-v1.ts';
import type { PhotoDevelopPresentationSnapshotV2, PhotoDevelopPresentationViewV2 } from './photo-library-develop-presentation-v2.ts';
import type { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';

export type PhotoDevelopPresentationSnapshotCurrentV1 = PhotoDevelopPresentationSnapshotV2;
export interface PhotoDevelopPresentationViewCurrentV1 extends Omit<PhotoDevelopPresentationViewV2, 'develop' | 'revision'> {
	readonly develop: PhotoLibraryDevelopSettingsV3;
	readonly revision: number;
}
export interface PhotoDevelopPresentationPortsCurrentV1 {
	readonly withOriginalFrame?: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly readPreview?: PixelPreviewPresentationReaderV1;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV3;
	readonly beforePresent?: Promise<void>;
	readonly paint?: typeof paintPixelFrameCanvasV1;
	readonly clear?: typeof clearPixelFrameCanvasV1;
}
export function preparePhotoDevelopPresentationViewCurrentV1(value: unknown): Readonly<PhotoDevelopPresentationViewCurrentV1> {
	return preparePhotoDevelopPresentationViewForProfileV1('current3', value) as Readonly<PhotoDevelopPresentationViewCurrentV1>;
}
/** Both display resolutions authenticate and render the full oriented Original. */
export class PhotoLibraryDevelopPresentationCurrentV1 extends PhotoLibraryDevelopPresentationKernelV1 {
	constructor(value: PhotoDevelopPresentationPortsCurrentV1) { super('current3', value); }
	override setView(value: PhotoDevelopPresentationViewCurrentV1): void { super.setView(value); }
}
