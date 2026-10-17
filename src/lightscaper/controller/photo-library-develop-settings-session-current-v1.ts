/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopSettingsPortCurrentV1 } from '../../common/editor/photo-library-develop-settings-port-current-v1.ts';
import { createPhotoLibraryDevelopSettingsSessionForProfileV1, type PhotoLibraryDevelopSettingsSessionHostCurrentV1 } from './internal/photo-library-develop-settings-session-kernel-v1.ts';
export type { PhotoLibraryDevelopSettingsSessionHostCurrentV1 } from './internal/photo-library-develop-settings-session-kernel-v1.ts';

export function createPhotoLibraryDevelopSettingsSessionCurrentV1(host: PhotoLibraryDevelopSettingsSessionHostCurrentV1): Readonly<PhotoLibraryDevelopSettingsPortCurrentV1> {
	return createPhotoLibraryDevelopSettingsSessionForProfileV1('current4', host);
}
