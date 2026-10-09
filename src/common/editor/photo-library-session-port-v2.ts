/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV1 } from './photo-library-session-port-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from './photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopImportPortV2 } from './photo-library-develop-import-port-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from './photo-library-cube-lut-port-v1.ts';

/** Fixed current Develop envelopes; scalar library and organization ports stay unchanged. */
export interface PhotoLibrarySessionPortV2 extends Omit<PhotoLibrarySessionPortV1, 'develop' | 'developImport'> {
	readonly develop: Readonly<PhotoLibraryDevelopPortV2>;
	readonly developImport: Readonly<PhotoLibraryDevelopImportPortV2>;
	readonly cubeLuts: Readonly<PhotoLibraryCubeLutPortV1>;
}
export type CreatePhotoLibrarySessionV3 = () => Promise<PhotoLibrarySessionPortV2>;
