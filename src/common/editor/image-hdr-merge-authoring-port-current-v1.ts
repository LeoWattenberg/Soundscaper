/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { ImageHdrRadianceDiagnosticsV1 } from './imaging/image-hdr-radiance-v1.ts';

export interface ImageHdrMergeAuthoringSourceCurrentV1 {
	readonly key: string;
	readonly label: string;
	readonly width: number;
	readonly height: number;
	readonly exposureSeconds: number | null;
	readonly aperture: number | null;
	readonly iso: number | null;
}
export interface ImageHdrMergeAuthoringSelectionCurrentV1 {
	readonly schemaVersion: 1;
	readonly sources: readonly Readonly<ImageHdrMergeAuthoringSourceCurrentV1>[];
	readonly suggestedExposureMultipliers: readonly number[] | null;
}
export interface ImageHdrMergeAuthoringOptionsCurrentV1 {
	readonly schemaVersion: 1;
	readonly referenceIndex: number;
	readonly exposureMultipliers: readonly number[];
	readonly alignment: 'none' | 'ward-mtb-v1';
	readonly deghost: Readonly<{ mode: 'off' | 'reference-v1'; threshold: number }>;
	readonly fileName: string;
}
export interface ImageHdrMergeAuthoringPreviewCurrentV1 {
	readonly frame: Readonly<{ descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8'; primaries: 'srgb'; transfer: 'srgb' }>; pixels: Uint8Array<ArrayBuffer> }>;
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; primaries: 'srgb'; transfer: 'linear' }>;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1>;
}

/** A product binds immutable source identities and validates its actual native
 * acknowledgement. The shared dialog neither opens sources nor publishes them. */
export interface ImageHdrMergeAuthoringPortCurrentV1<Acknowledgement = unknown> {
	readonly schemaVersion: 1;
	readSelection(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<ImageHdrMergeAuthoringSelectionCurrentV1>>;
	withPreview<Result>(request: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>,
		consume: (view: Readonly<ImageHdrMergeAuthoringPreviewCurrentV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
	merge(request: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>,
		options?: Readonly<{ signal?: AbortSignal; onAcknowledged?: (value: Readonly<Acknowledgement>) => void }>):
		Promise<Readonly<{ acknowledgement: Readonly<Acknowledgement>; diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1> }>>;
}
