/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopSettingsPortV2, PhotoLibraryDevelopBatchRequestV2 } from '../../common/editor/photo-library-develop-settings-port-v2.ts';
import { createPhotoLibraryDevelopSettingsSessionForProfileV1, normalizePhotoLibraryDevelopBatchForProfileV1,
	type PhotoLibraryDevelopSettingsSessionHostV2 } from './internal/photo-library-develop-settings-session-kernel-v1.ts';
export type { PhotoLibraryDevelopSettingsSessionHostV2 } from './internal/photo-library-develop-settings-session-kernel-v1.ts';

export function createPhotoLibraryDevelopSettingsSessionV2(host: PhotoLibraryDevelopSettingsSessionHostV2): Readonly<PhotoLibraryDevelopSettingsPortV2> {
	return createPhotoLibraryDevelopSettingsSessionForProfileV1('legacy2', host);
}
export function normalizePhotoLibraryDevelopBatchV2(value: unknown): PhotoLibraryDevelopBatchRequestV2 {
	return normalizePhotoLibraryDevelopBatchForProfileV1('legacy2', value) as PhotoLibraryDevelopBatchRequestV2;
}
