/* SPDX-License-Identifier: AGPL-3.0-only */
import { PhotoRasterExportJournalOwnerKernelV1, type PhotoRasterExportJournalSettingsV1 } from './internal/photo-raster-export-journal-owner-kernel-v1.ts';
export { PhotoRasterExportJournalErrorV1 } from './internal/photo-raster-export-journal-owner-kernel-v1.ts';
export type { PhotoRasterExportJournalSettingsV1 } from './internal/photo-raster-export-journal-owner-kernel-v1.ts';

/** Permanent legacy publication/readback reconciliation, including lost ACKs. */
export class PhotoRasterExportJournalOwnerV1 extends PhotoRasterExportJournalOwnerKernelV1 {
	constructor(settings: PhotoRasterExportJournalSettingsV1, catalogId: string) { super('legacy1', settings, catalogId); }
}
