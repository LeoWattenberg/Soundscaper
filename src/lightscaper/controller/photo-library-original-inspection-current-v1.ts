/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { readPhotoLibraryOriginalInspectionPageCore, type PhotoOriginalInspectionCursorCore, type PhotoOriginalInspectionPortsCore } from './photo-library-original-inspection-core.ts';
import type { PhotoLibraryOriginalInspectionFailureV1, PhotoLibraryOriginalInspectionPageV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
export { admitPhotoLibraryOriginalInspectionRequestV1, photoOriginalInspectionFailureV1 } from './photo-library-original-inspection-core.ts';
export type PhotoLibraryOriginalInspectionPortsCurrentV1 = PhotoOriginalInspectionPortsCore;

/** Current documents share the immutable original root/intent authority and serial scan. */
export function readPhotoLibraryOriginalInspectionPageCurrentV1(catalogId: string, ports: PhotoLibraryOriginalInspectionPortsCurrentV1,
	cursor: PhotoOriginalInspectionCursorCore | null, startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null,
	signal: AbortSignal): Promise<PhotoLibraryOriginalInspectionPageV1> {
	return readPhotoLibraryOriginalInspectionPageCore(catalogId, ports, cursor, startupFailure, signal, normalizePhotoDocumentCurrentV1);
}
