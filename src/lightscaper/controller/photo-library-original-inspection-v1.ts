/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import { readPhotoLibraryOriginalInspectionPageCore, type PhotoOriginalInspectionCursorCore, type PhotoLibraryOriginalInspectionPortV1 } from './photo-library-original-inspection-core.ts';
import type { PhotoLibraryOriginalInspectionFailureV1, PhotoLibraryOriginalInspectionPageV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
export { admitPhotoLibraryOriginalInspectionRequestV1, photoOriginalInspectionFailureV1 } from './photo-library-original-inspection-core.ts';
export type { PhotoLibraryOriginalInspectionPortV1, PhotoLibraryOriginalBodyInspectionV1, PhotoLibraryOriginalInspectionFailureV1, PhotoLibraryOriginalInspectionPageV1 } from './photo-library-original-inspection-core.ts';

type Ports = Pick<PhotoLibrarySessionPortsV1, 'catalog' | 'journal' | 'media'> & { readonly originalInspection: PhotoLibraryOriginalInspectionPortV1 };

/** Fixed legacy full-document authority; callers cannot replace its admission. */
export function readPhotoLibraryOriginalInspectionPageV1(catalogId: string, ports: Ports, cursor: PhotoOriginalInspectionCursorCore | null,
	startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null, signal: AbortSignal): Promise<PhotoLibraryOriginalInspectionPageV1> {
	return readPhotoLibraryOriginalInspectionPageCore(catalogId, ports, cursor, startupFailure, signal, readLegacyPhoto);
}

function readLegacyPhoto(value: unknown) {
	const photo = validateLightscaperDocumentV1(value);
	if (photo.kind !== 'photo') throw new TypeError('Original inspection requires a published photo document.'); return photo;
}
