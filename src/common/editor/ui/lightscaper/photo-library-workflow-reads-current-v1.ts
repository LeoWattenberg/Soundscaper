/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoLibraryWorkflowReadsForProfileV1,
	type PhotoLibraryWorkflowReadOwnersCurrentV1 } from './photo-library-workflow-reads-kernel-v1.ts';

/** Selected Current reads share the fixed owner lifecycle with legacy reads. */
export function usePhotoLibraryWorkflowReadsCurrentV1(owners: PhotoLibraryWorkflowReadOwnersCurrentV1) {
	return usePhotoLibraryWorkflowReadsForProfileV1('current3', owners);
}
