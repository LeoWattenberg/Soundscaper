/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { restorePhotoLibraryOriginalBodyCore, type PhotoOriginalRestorationPortsCore } from './photo-library-original-restoration-core.ts';
import type { PhotoLibraryOriginalRestoreTargetV1, PhotoLibraryOriginalRestorationReceiptV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
export { admitPhotoLibraryOriginalRestorationRequestV1 } from './photo-library-original-restoration-core.ts';
export type PhotoLibraryOriginalRestorationPortsV2 = PhotoOriginalRestorationPortsCore;

/** Fixed current full Photo1/2 admission before immutable original repair binding. */
export function restorePhotoLibraryOriginalBodyV2(catalogId: string, ports: PhotoLibraryOriginalRestorationPortsV2, target: PhotoLibraryOriginalRestoreTargetV1,
	selected: Blob, signal: AbortSignal): Promise<PhotoLibraryOriginalRestorationReceiptV1> {
	return restorePhotoLibraryOriginalBodyCore(catalogId, ports, target, selected, signal, normalizePhotoDocumentV1OrV2);
}
