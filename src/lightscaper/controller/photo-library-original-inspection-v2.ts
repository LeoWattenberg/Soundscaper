/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { readPhotoLibraryOriginalInspectionPageCore, type PhotoOriginalInspectionCursorCore, type PhotoOriginalInspectionPortsCore } from './photo-library-original-inspection-core.ts';
import type { PhotoLibraryOriginalInspectionFailureV1, PhotoLibraryOriginalInspectionPageV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
export { admitPhotoLibraryOriginalInspectionRequestV1, photoOriginalInspectionFailureV1 } from './photo-library-original-inspection-core.ts';
export type PhotoLibraryOriginalInspectionPortsV2 = PhotoOriginalInspectionPortsCore;

/** Fixed current full Photo1/2 authority; root/intent/custody scalar contracts stay V1. */
export function readPhotoLibraryOriginalInspectionPageV2(catalogId: string, ports: PhotoLibraryOriginalInspectionPortsV2, cursor: PhotoOriginalInspectionCursorCore | null,
	startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null, signal: AbortSignal): Promise<PhotoLibraryOriginalInspectionPageV1> {
	return readPhotoLibraryOriginalInspectionPageCore(catalogId, ports, cursor, startupFailure, signal, normalizePhotoDocumentV1OrV2);
}
