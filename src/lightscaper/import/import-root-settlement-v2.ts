/* SPDX-License-Identifier: AGPL-3.0-only */

import { settlePhotoImportRootsForProfileV1, verifyManagedImportResourcesForProfileV1 } from './import-root-settlement-kernel-v2.ts';
import type { PhotoImportIntentV1 } from './import-intent-v1.ts';
import type { PhotoManagedImportPortsV2 } from './managed-import-ports-v2.ts';
import type { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
export { checkManagedImportSignalV2 } from './import-root-settlement-kernel-v2.ts';

export function verifyManagedImportResourcesV2(photo: ReturnType<typeof normalizePhotoDocumentV1OrV2>, ports: PhotoManagedImportPortsV2, signal?: AbortSignal): Promise<void> {
	return verifyManagedImportResourcesForProfileV1('legacy2', photo, ports, signal);
}
export function settlePhotoImportRootsV2(intent: PhotoImportIntentV1, ports: PhotoManagedImportPortsV2, signal?: AbortSignal): Promise<void> {
	return settlePhotoImportRootsForProfileV1('legacy2', intent, ports, signal);
}
