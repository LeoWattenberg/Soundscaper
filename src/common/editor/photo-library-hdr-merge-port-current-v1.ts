/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryImportItemV1 } from './photo-library-session-port-v1.ts';
import type { ImageHdrRadianceDiagnosticsV1 } from './imaging/image-hdr-radiance-v1.ts';
import type { ImageHdrMergePreviewCurrentV1 } from './controller/shared/image-hdr-merge-preview-current-v1.ts';

export interface PhotoLibraryHdrMergeSourceCurrentV1 {
	readonly photoId: string; readonly revision: number; readonly fileName: string;
	readonly width: number; readonly height: number; readonly mimeType: string;
	readonly profile: 'encoded-srgb8' | 'linear-srgb16';
	/** Immutable extracted facts only; authored metadata never supplies advice. */
	readonly exposureSeconds: number | null; readonly aperture: number | null; readonly iso: number | null;
}
export interface PhotoLibraryHdrMergeSelectionCurrentV1 {
	readonly schemaVersion: 1; readonly catalogId: string;
	readonly sources: readonly Readonly<PhotoLibraryHdrMergeSourceCurrentV1>[];
	/** Relative to the first source. Null unless shutter, aperture and ISO agree
	 * with the complete fixed-capture policy. Explicit input values own merging. */
	readonly suggestedExposureMultipliers: readonly number[] | null;
}
export interface PhotoLibraryHdrMergeRequestCurrentV1 {
	readonly schemaVersion: 1;
	readonly inputs: readonly Readonly<{ photoId: string; expectedRevision: number; exposureMultiplier: number }>[];
	readonly referenceIndex: number; readonly alignment: 'none' | 'ward-mtb-v1';
	readonly deghost: Readonly<{ mode: 'off' | 'reference-v1'; threshold: number }>;
	readonly fileName: string;
}
export interface PhotoLibraryHdrMergeResultCurrentV1 {
	readonly schemaVersion: 1; readonly receipt: Readonly<PhotoLibraryImportItemV1>;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1>;
}
export interface PhotoLibraryHdrMergePortCurrentV1 {
	readonly schemaVersion: 1;
	readSelection(request: Readonly<{ schemaVersion: 1; photoIds: readonly string[] }>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<PhotoLibraryHdrMergeSelectionCurrentV1>>;
	merge(request: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>, options?: Readonly<{ signal?: AbortSignal;
		/** Positive native ACK precedes interruptible custody promotion. */
		onAcknowledged?: (item: Readonly<PhotoLibraryImportItemV1>) => void }>): Promise<Readonly<PhotoLibraryHdrMergeResultCurrentV1>>;
	withPreview<Result>(request: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>, consume: (view: Readonly<ImageHdrMergePreviewCurrentV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
