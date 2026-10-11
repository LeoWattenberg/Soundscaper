/* SPDX-License-Identifier: AGPL-3.0-only */
import { openPhotoLibraryExportJournalForProfileV1, type PhotoLibraryExportJournalHostCurrentV1 } from './internal/photo-library-export-journal-kernel-v1.ts';

/** Genuine whole Current verification shares the selected scalar CAS owner. */
export function openPhotoLibraryExportJournalCurrentSession(host: PhotoLibraryExportJournalHostCurrentV1, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return openPhotoLibraryExportJournalForProfileV1('current3', host, options);
}
