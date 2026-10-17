/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { restorePhotoLibraryOriginalBodyCore, type PhotoOriginalRestorationPortsCore } from './photo-library-original-restoration-core.ts';
import type { PhotoLibraryOriginalRestoreTargetV1, PhotoLibraryOriginalRestorationReceiptV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
export { admitPhotoLibraryOriginalRestorationRequestV1 } from './photo-library-original-restoration-core.ts';
export type PhotoLibraryOriginalRestorationPortsCurrentV1 = PhotoOriginalRestorationPortsCore;

/** Repair settings never alter the immutable original restoration binding or body. */
export function restorePhotoLibraryOriginalBodyCurrentV1(catalogId: string, ports: PhotoLibraryOriginalRestorationPortsCurrentV1,
	target: PhotoLibraryOriginalRestoreTargetV1, selected: Blob, signal: AbortSignal): Promise<PhotoLibraryOriginalRestorationReceiptV1> {
	return restorePhotoLibraryOriginalBodyCore(catalogId, ports, target, selected, signal, normalizePhotoDocumentCurrentV1);
}
