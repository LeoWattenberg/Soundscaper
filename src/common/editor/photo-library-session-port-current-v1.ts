/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV2, ReadPhotoExportSidecar, PhotoLibraryExportJournalPort } from './photo-library-session-port-v2.ts';
import type { PhotoLibraryDevelopPortV3 } from './photo-library-develop-port-v3.ts';
import type { PhotoLibraryDevelopPortV2 } from './photo-library-develop-port-v2.ts';

/** Current Develop settings with unchanged scalar library and organization capabilities. */
export interface PhotoLibrarySessionPortCurrentV1 extends Omit<PhotoLibrarySessionPortV2, 'develop'> {
	readonly develop: Readonly<PhotoLibraryDevelopPortV3>;
	/** A genuine legacy capability, admitted against the complete retained Photo1/2 document. */
	readonly legacyDevelop?: Readonly<PhotoLibraryDevelopPortV2>;
	/** Full retained Current provenance; the inherited legacy reader stays strict. */
	readonly readExportSidecarCurrent?: ReadPhotoExportSidecar;
	/** Same scalar journal wire, verified against the complete selected Current Photo. */
	readonly exportJournalCurrent?: Readonly<PhotoLibraryExportJournalPort>;
}
export type CreatePhotoLibrarySessionCurrentV1 = () => Promise<PhotoLibrarySessionPortCurrentV1>;
