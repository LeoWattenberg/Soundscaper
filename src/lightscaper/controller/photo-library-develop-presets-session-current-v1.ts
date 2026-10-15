/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetsPortCurrentV1 } from '../../common/editor/photo-library-develop-presets-port-current-v1.ts';
import { createPhotoLibraryDevelopPresetsSessionForProfileV1, type PhotoLibraryDevelopPresetsSessionHostCurrentV1 } from './internal/photo-library-develop-presets-session-kernel-v1.ts';
export type { PhotoLibraryDevelopPresetStorageCurrentV1, PhotoLibraryDevelopPresetsSessionHostCurrentV1 } from './internal/photo-library-develop-presets-session-kernel-v1.ts';

export function createPhotoLibraryDevelopPresetsSessionCurrentV1(host: PhotoLibraryDevelopPresetsSessionHostCurrentV1): Readonly<PhotoLibraryDevelopPresetsPortCurrentV1> {
	return createPhotoLibraryDevelopPresetsSessionForProfileV1('current4', host);
}
