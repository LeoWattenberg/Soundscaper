/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelPreviewPresentationReaderV1 } from './pixel-preview-presentation-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { withPixelFrameBodyV1 } from '../../imaging/pixel-frame-body-v1.ts';
import type { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import type { PixelFrameHistogramV1 } from '../../imaging/pixel-frame-histogram-v1.ts';
import type { ImageDevelopMaskOverlaySelectionV1 } from '../../imaging/image-develop-mask-overlay-v1.ts';
import type { PhotoDevelopMaskDisplayModeV1 } from '../../photo-develop-mask-display-v1.ts';
import { PhotoLibraryDevelopPresentationKernelV1, preparePhotoDevelopPresentationViewForProfileV1 } from './internal/photo-library-develop-presentation-kernel-v1.ts';

export interface PhotoDevelopPresentationSnapshotV2 {
	readonly status: 'idle' | 'pending' | 'ready' | 'missing' | 'failed';
	readonly before: Readonly<PixelFrameHistogramV1> | null;
	readonly after: Readonly<PixelFrameHistogramV1> | null;
	readonly extent: Readonly<{ before: Readonly<{ width: number; height: number }>; after: Readonly<{ width: number; height: number }> }> | null;
	readonly error: string | null;
}
export interface PhotoDevelopPresentationViewV2 {
	readonly resolution?: PhotoDevelopResolutionV1;
	readonly revision?: number;
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly before: HTMLCanvasElement;
	readonly after: HTMLCanvasElement;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
	readonly maskOverlayMode?: PhotoDevelopMaskDisplayModeV1;
	readonly overlay?: HTMLCanvasElement;
}
interface Ports {
	readonly withOriginalFrame?: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly beforePresent?: Promise<void>;
	readonly stage?: typeof withPixelFrameBodyV1;
	readonly paint?: typeof paintPixelFrameCanvasV1;
	readonly clear?: typeof clearPixelFrameCanvasV1;
}
export function preparePhotoDevelopPresentationViewV2(value: unknown): Readonly<PhotoDevelopPresentationViewV2> {
	return preparePhotoDevelopPresentationViewForProfileV1('legacy2', value) as Readonly<PhotoDevelopPresentationViewV2>;
}
/** Permanently strict legacy admission over the existing joined lifecycle. */
export class PhotoLibraryDevelopPresentationV2 extends PhotoLibraryDevelopPresentationKernelV1 {
	constructor(value: Ports) { super('legacy2', value); }
	override setView(value: PhotoDevelopPresentationViewV2): void { super.setView(value); }
}
