/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetsPortV2 } from '../../common/editor/photo-library-develop-presets-port-v2.ts';
import { createPhotoLibraryDevelopPresetsSessionForProfileV1, type PhotoLibraryDevelopPresetsSessionHostV2 } from './internal/photo-library-develop-presets-session-kernel-v1.ts';
export type { PhotoLibraryDevelopPresetStorageV2, PhotoLibraryDevelopPresetsSessionHostV2 } from './internal/photo-library-develop-presets-session-kernel-v1.ts';

export function createPhotoLibraryDevelopPresetsSessionV2(host: PhotoLibraryDevelopPresetsSessionHostV2): Readonly<PhotoLibraryDevelopPresetsPortV2> {
	return createPhotoLibraryDevelopPresetsSessionForProfileV1('legacy2', host);
}
