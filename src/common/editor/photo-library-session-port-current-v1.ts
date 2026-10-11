/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV2 } from './photo-library-session-port-v2.ts';
import type { PhotoLibraryDevelopPortV3 } from './photo-library-develop-port-v3.ts';

/** Current Develop settings with unchanged scalar library and organization capabilities. */
export interface PhotoLibrarySessionPortCurrentV1 extends Omit<PhotoLibrarySessionPortV2, 'develop'> {
	readonly develop: Readonly<PhotoLibraryDevelopPortV3>;
}
export type CreatePhotoLibrarySessionCurrentV1 = () => Promise<PhotoLibrarySessionPortCurrentV1>;
