/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoLibraryWorkflowReadsForProfileV1, type PhotoLibraryWorkflowReadOwnersLegacyV2 } from './photo-library-workflow-reads-kernel-v1.ts';
export function usePhotoLibraryWorkflowReads(owners: PhotoLibraryWorkflowReadOwnersLegacyV2) {
	return usePhotoLibraryWorkflowReadsForProfileV1('legacy2', owners);
}
