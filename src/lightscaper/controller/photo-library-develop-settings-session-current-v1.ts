/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopSettingsPortV3 } from '../../common/editor/photo-library-develop-settings-port-v3.ts';
import { createPhotoLibraryDevelopSettingsSessionForProfileV1, type PhotoLibraryDevelopSettingsSessionHostCurrentV1 } from './internal/photo-library-develop-settings-session-kernel-v1.ts';
export type { PhotoLibraryDevelopSettingsSessionHostCurrentV1 } from './internal/photo-library-develop-settings-session-kernel-v1.ts';

export function createPhotoLibraryDevelopSettingsSessionCurrentV1(host: PhotoLibraryDevelopSettingsSessionHostCurrentV1): Readonly<PhotoLibraryDevelopSettingsPortV3> {
	return createPhotoLibraryDevelopSettingsSessionForProfileV1('current3', host);
}
