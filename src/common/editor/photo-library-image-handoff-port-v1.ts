/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CubeLutSourcePortV1 } from './imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from './video-color-cube-lut-v27.ts';

export interface PhotoLibraryImageHandoffRequestV1 {
	readonly catalogId: string; readonly photoId: string; readonly versionId: string; readonly expectedRevision: number;
}
export interface PhotoLibraryImageHandoffViewV1 {
	readonly schemaVersion: 1;
	/** Native signal combining caller cancellation and selected Session retirement. */
	readonly signal: AbortSignal;
	/** Canonical selected-version Photo sidecar, not body or publication authority. */
	readonly factsJson: string;
	readonly original: Readonly<{ exactName: string; contentSha256: string; byteLength: number; mimeType: string;
		width: number; height: number; hasAlpha: boolean }>;
	readonly originalBlob: Blob;
	readonly lutReferences: readonly Readonly<VideoCubeLutReferenceV1>[];
	readonly withLutBytes: CubeLutSourcePortV1['withBytes'];
}

/** One selected Session operation borrows the authenticated encoded original
 * and selected recipe's active AND disabled LUTs. Consumers must join their
 * reads and not retain body authority; the resource capability seals when the
 * consumer settles; one LUT read may be active at a time, using its captured
 * signal (or no additional signal). Complete Photo metadata/history remain sender-owned.
 * This capture performs no decoding, rendering, storage or publication. */
export interface PhotoLibraryImageHandoffPortV1 {
	withCapture<Result>(request: Readonly<PhotoLibraryImageHandoffRequestV1>,
		consume: (view: Readonly<PhotoLibraryImageHandoffViewV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
