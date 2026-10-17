/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoMetadataQueryRuntimeV2, PhotoLibraryQueryV2 } from './photo-library-query-port-v2.ts';
import type { PhotoLibraryQueryV1 } from './photo-library-session-port-v1.ts';

/** Pure product controls load only after a saved-filter menu is opened. */
export interface PhotoSavedFilterRuntimeV1 extends PhotoMetadataQueryRuntimeV2 {
	readonly readQueryJson: (value: unknown) => PhotoLibraryQueryV2;
	readonly writeQueryJson: (value: PhotoLibraryQueryV1 | PhotoLibraryQueryV2) => string;
}
export type LoadPhotoSavedFilterRuntimeV1 = () => Promise<PhotoSavedFilterRuntimeV1>;
