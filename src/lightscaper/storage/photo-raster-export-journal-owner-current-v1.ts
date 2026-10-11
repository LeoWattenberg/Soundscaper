/* SPDX-License-Identifier: AGPL-3.0-only */
import { PhotoRasterExportJournalOwnerKernelV1, type PhotoRasterExportJournalSettingsV1 } from './internal/photo-raster-export-journal-owner-kernel-v1.ts';

/** Current fresh image/JSON delivery requires this caller's positive native
 * claim ACK. Matching readback is retained only for explicit recovery review. */
export class PhotoRasterExportJournalOwnerCurrentV1 extends PhotoRasterExportJournalOwnerKernelV1 {
	constructor(settings: PhotoRasterExportJournalSettingsV1, catalogId: string) { super('current1', settings, catalogId); }
}
