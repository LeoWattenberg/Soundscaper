/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CubeLutSourcePortV1 } from './imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from './video-color-cube-lut-v27.ts';

/** Selected runtime capability; recipe parameters retain scalar references only. */
export interface PhotoLibraryCubeLutPortV1 {
	readonly schemaVersion: 1;
	readonly source: Readonly<CubeLutSourcePortV1>;
	importFile(file: Blob, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{
		reference: Readonly<VideoCubeLutReferenceV1>; created: boolean;
	}>>;
}
