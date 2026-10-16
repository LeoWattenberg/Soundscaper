/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PixelFrameDescriptorV1, PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import type { ImageHdrOriginalInputV1, ImageHdrOriginalProvenanceV1 } from '../../imaging/image-hdr-original-contract-v1.ts';
import type { ImageHdrRadianceDiagnosticsV1 } from '../../imaging/image-hdr-radiance-v1.ts';
import type { withImageHdrPixelStagingV1 } from '../../storage/image-hdr-pixel-staging-v1.ts';
import { captureImageHdrMergeCurrentV1 } from './internal/image-hdr-merge-capture-current-v1.ts';
import { withCapturedImageHdrMergeCurrentV1 } from './internal/image-hdr-merge-owner-current-v1.ts';

export interface ImageHdrMergeInputCurrentV1 extends Pick<ImageHdrOriginalInputV1, 'product' | 'ownerId' | 'sourceId' | 'revision' | 'original' | 'exposureMultiplier'> {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
}
export interface ImageHdrMergeRequestCurrentV1 {
	readonly schemaVersion: 1;
	readonly referenceIndex: number;
	readonly alignment: 'none' | 'ward-mtb-v1';
	readonly deghost: Readonly<{ mode: 'off' | 'reference-v1'; threshold: number }>;
	readonly inputs: readonly Readonly<ImageHdrMergeInputCurrentV1>[];
	readonly signal?: AbortSignal;
}
export interface ImageHdrMergePortsCurrentV1 {
	withCanonicalFrame<Result>(index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result>;
	readonly withStaging?: typeof withImageHdrPixelStagingV1;
}
export interface ImageHdrMergeResultCurrentV1 {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	readonly sha256: string;
	readonly provenance: Readonly<ImageHdrOriginalProvenanceV1>;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1>;
}

/** Shared source-space creation, independent of saved creative Develop. Native
 * product borrowers authenticate captured Originals; this owner joins each
 * borrow, all staging and Float32 retirement before lending encoded output. */
export async function withMergedImageHdrOriginalCurrentV1<Result>(request: unknown,
	ports: Readonly<ImageHdrMergePortsCurrentV1>, consume: (view: Readonly<ImageHdrMergeResultCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	const captured = captureImageHdrMergeCurrentV1(request, ports);
	if (typeof consume !== 'function') throw new TypeError('HDR merging requires a scoped encoded consumer.');
	return withCapturedImageHdrMergeCurrentV1(captured, consume);
}
