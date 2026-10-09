/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import { restorePhotoLibraryOriginalBodyCore } from './photo-library-original-restoration-core.ts';
import type { PhotoLibraryOriginalRestoreTargetV1, PhotoLibraryOriginalRestorationReceiptV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
export { admitPhotoLibraryOriginalRestorationRequestV1 } from './photo-library-original-restoration-core.ts';
type Ports = Pick<PhotoLibrarySessionPortsV1, 'catalog' | 'journal'> & { readonly originalRestoration: NonNullable<PhotoLibrarySessionPortsV1['originalRestoration']> };

/** Fixed legacy full-document authority; original body and scalar ACK policy is unchanged. */
export function restorePhotoLibraryOriginalBodyV1(catalogId: string, ports: Ports, target: PhotoLibraryOriginalRestoreTargetV1,
	selected: Blob, signal: AbortSignal): Promise<PhotoLibraryOriginalRestorationReceiptV1> {
	return restorePhotoLibraryOriginalBodyCore(catalogId, ports, target, selected, signal, readLegacyPhoto);
}

function readLegacyPhoto(value: unknown) {
	const photo = validateLightscaperDocumentV1(value);
	if (photo.kind !== 'photo') throw new Error('Restoration photo identity or revision changed.'); return photo;
}
