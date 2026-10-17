/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibrarySessionForProfileV1, type PhotoLibrarySessionRuntimeOptionsV3 } from './photo-library-session-runtime-kernel-v3.ts';
import type { PhotoLibrarySessionV2 } from './controller/photo-library-session-v2.ts';
export type { PhotoLibrarySessionRuntimeOptionsV3 } from './photo-library-session-runtime-kernel-v3.ts';

/** Fixed legacy Session keeps its exact runtime option and Photo1/2 admission. */
export async function createPhotoLibrarySessionV3(options: PhotoLibrarySessionRuntimeOptionsV3): Promise<PhotoLibrarySessionV2> {
	return await createPhotoLibrarySessionForProfileV1('legacy2', options) as PhotoLibrarySessionV2;
}
