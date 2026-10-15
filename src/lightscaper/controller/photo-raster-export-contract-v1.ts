/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoRasterSidecarReceipt } from './photo-raster-export-sidecar.ts';
import type { ReadPhotoExportSidecar } from '../../common/editor/photo-library-session-port-v2.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../common/editor/browser-file-save-service.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { ExecutePhotoDevelopV2 } from '../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PixelFrameLimitsV1, PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { ImageExportSizingV1 } from '../../common/editor/imaging/image-export-size-v1.ts';
import { normalizeDetailSharpenParamsV1 } from '../../common/editor/video-sharpen-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../../common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopProxyRuntimeV3 } from '../../common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PhotoLibraryMetadataSnapshotV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { ImageExportGraphicRequest } from '../../common/editor/image-export-graphic-request.ts';
import type { withImageExportGraphicFrameV1 } from '../../common/editor/imaging/image-export-graphic-source-v1.ts';
import { captureImageExportTextV1, type ImageExportTextV1 } from '../../common/editor/image-export-text-v1.ts';
import type { withImageExportTextFrameV1 } from '../../common/editor/imaging/image-export-text-frame-v1.ts';
import type { PhotoRasterExportOutputCurrentV1 } from './photo-raster-export-output-current-v1.ts';

export type ReadPhotoExportMetadata = (photoId: string, expectedRevision: number, options: Readonly<{ signal: AbortSignal }>) =>
	Promise<Readonly<{ catalogId: string; snapshot: PhotoLibraryMetadataSnapshotV1 }>>;

export interface PhotoRasterExportRequest {
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
	readonly fileName: string;
	readonly fileTypeDescription: string;
	readonly signal?: AbortSignal;
	readonly output?: PhotoRasterExportOutput;
	readonly readMetadata?: ReadPhotoExportMetadata;
	readonly sidecar?: Readonly<{ read: ReadPhotoExportSidecar }>;
	readonly graphicWatermark?: Readonly<ImageExportGraphicRequest>;
	readonly withGraphicFrame?: typeof withImageExportGraphicFrameV1;
	readonly withTextFrame?: typeof withImageExportTextFrameV1;
	readonly prepareSave: (request: BrowserFileSaveRequest) => PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
	readonly saveFile: (request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>;
	readonly execute: ExecutePhotoDevelopV2;
	readonly withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly loadRenderer: () => Promise<Pick<PhotoLibraryDevelopProxyRuntimeV2, 'withFullResolution'>>;
	readonly encode: (frame: Readonly<PixelFrameV1>, options: Readonly<{
		signal: AbortSignal; limits: PixelFrameLimitsV1; maximumOutputBytes: number;
	}>) => Promise<Uint8Array<ArrayBuffer>>;
}

export interface PhotoRasterExportOutput {
	readonly sizing: ImageExportSizingV1;
	readonly quality: 'nearest' | 'bilinear';
	readonly sharpen?: Readonly<{ amount: number; threshold: number }>;
	readonly metadataScope?: 'strip' | 'capture';
	readonly textWatermark?: Readonly<ImageExportTextV1>;
}

/** Capture output settings in the Save gesture. Actual frame capacity is checked after Develop. */
export function capturePhotoRasterExportOutput(value: unknown): Readonly<PhotoRasterExportOutput> {
	const input = record(value, 'Photo raster output', ['sizing', 'quality', 'sharpen', 'metadataScope', 'textWatermark'], ['sizing', 'quality']), quality = field(input, 'quality', 'Photo raster output');
	const metadataScope = Object.hasOwn(input, 'metadataScope') ? field(input, 'metadataScope', 'Photo raster output') : 'strip';
	if (metadataScope !== 'strip' && metadataScope !== 'capture') throw new RangeError('Unsupported photo export metadata scope.');
	const sharpen = Object.hasOwn(input, 'sharpen') ? normalizeDetailSharpenParamsV1(field(input, 'sharpen', 'Photo raster output')) : undefined;
	const textWatermark = Object.hasOwn(input, 'textWatermark') ? captureImageExportTextV1(field(input, 'textWatermark', 'Photo raster output')) : undefined;
	if (quality !== 'nearest' && quality !== 'bilinear') throw new RangeError('Unsupported photo export resampling.');
	const candidate = record(field(input, 'sizing', 'Photo raster output'), 'Photo raster sizing', ['kind', 'width', 'height', 'pixels', 'megapixels', 'percentage', 'allowUpscale'], ['kind']);
	const kind = field(candidate, 'kind', 'Photo raster sizing');
	const keys = kind === 'original' ? ['kind'] : kind === 'fit' ? ['kind', 'width', 'height', 'allowUpscale']
		: kind === 'long-edge' ? ['kind', 'pixels', 'allowUpscale'] : kind === 'megapixels' ? ['kind', 'megapixels', 'allowUpscale']
			: kind === 'percentage' ? ['kind', 'percentage'] : null;
	if (!keys) throw new RangeError('Unsupported photo export sizing.');
	const sizing = record(candidate, 'Photo raster sizing', keys), captured: Record<string, string | number | boolean> = { kind: kind as string };
	for (const key of keys.slice(1)) {
		const item = field(sizing, key, 'Photo raster sizing');
		if (key === 'allowUpscale') { if (typeof item !== 'boolean') throw new TypeError('Photo export upscaling requires a boolean.'); }
		else {
			const side = key === 'width' || key === 'height' || key === 'pixels';
			const minimum = key === 'megapixels' ? 0.000_001 : side ? 1 : Number.MIN_VALUE;
			const maximum = key === 'megapixels' ? PIXEL_FRAME_HARD_LIMITS_V1.maximumPixels / 1_000_000 : side ? PIXEL_FRAME_HARD_LIMITS_V1.maximumSidePixels : 10_000;
			if (typeof item !== 'number' || !Number.isFinite(item) || item < minimum || item > maximum || (side && !Number.isSafeInteger(item))) throw new RangeError('Photo export sizing exceeds its numeric bounds.');
		}
		captured[key] = item as number | boolean;
	}
	return Object.freeze({ sizing: Object.freeze(captured) as unknown as ImageExportSizingV1, quality, metadataScope, ...(sharpen ? { sharpen } : {}), ...(textWatermark ? { textWatermark } : {}) });
}

export type PhotoRasterExportReceipt = Readonly<{ status: 'cancelled' }> | Readonly<{
	status: 'saved' | 'download-started'; photoId: string; versionId: string; revision: number;
	width: number; height: number; byteLength: number; fileName: string;
	method: 'desktop' | 'file-system-access' | 'download';
	sidecar?: PhotoRasterSidecarReceipt;
}>;

const METADATA_REFUSALS = new WeakSet<object>();
export function isPhotoRasterExportMetadataRefusal(value: unknown): boolean {
	return typeof value === 'object' && value !== null && METADATA_REFUSALS.has(value);
}

/** An opted-in metadata read/admission refused before destination publication. */
export class PhotoRasterExportMetadataRefusal extends Error {
	constructor(cause: unknown) { super('Capture metadata could not be included. Choose Strip to export without it.', { cause }); METADATA_REFUSALS.add(this); }
}

export interface PhotoRasterExportRequestCurrentV1 extends Omit<PhotoRasterExportRequest, 'execute' | 'loadRenderer' | 'output' | 'encode'> {
	readonly execute: ExecutePhotoDevelopCurrentV1;
	readonly loadRenderer: () => Promise<Pick<PhotoLibraryDevelopProxyRuntimeV3, 'withFullResolution'>>;
	readonly output?: PhotoRasterExportOutputCurrentV1;
	readonly encode: (frame: Readonly<PixelFrameV1>, options: Readonly<{
		signal: AbortSignal; limits: PixelFrameLimitsV1; maximumOutputBytes: number; bitDepth?: 8 | 16;
	}>) => Promise<Uint8Array<ArrayBuffer>>;
}
export type PhotoRasterExportProfileV1 = 'legacy2' | 'current3';
export type PhotoRasterExportRequestForProfileV1<Profile extends PhotoRasterExportProfileV1> =
	Profile extends 'current3' ? PhotoRasterExportRequestCurrentV1 : PhotoRasterExportRequest;
