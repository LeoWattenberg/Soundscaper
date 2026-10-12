/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetsPortV3 } from '../../common/editor/photo-library-develop-presets-port-v3.ts';
import { createPhotoLibraryDevelopPresetsSessionForProfileV1, type PhotoLibraryDevelopPresetsSessionHostCurrentV1 } from './internal/photo-library-develop-presets-session-kernel-v1.ts';
export type { PhotoLibraryDevelopPresetStorageCurrentV1, PhotoLibraryDevelopPresetsSessionHostCurrentV1 } from './internal/photo-library-develop-presets-session-kernel-v1.ts';

export function createPhotoLibraryDevelopPresetsSessionCurrentV1(host: PhotoLibraryDevelopPresetsSessionHostCurrentV1): Readonly<PhotoLibraryDevelopPresetsPortV3> {
	return createPhotoLibraryDevelopPresetsSessionForProfileV1('current3', host);
}
