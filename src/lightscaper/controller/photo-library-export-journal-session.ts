/* SPDX-License-Identifier: AGPL-3.0-only */
import { openPhotoLibraryExportJournalForProfileV1, type PhotoLibraryExportJournalHostV1 } from './internal/photo-library-export-journal-kernel-v1.ts';

/** Permanent legacy journal verifies complete Photo1/2 only. */
export function openPhotoLibraryExportJournalSession(host: PhotoLibraryExportJournalHostV1, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return openPhotoLibraryExportJournalForProfileV1('legacy2', host, options);
}
