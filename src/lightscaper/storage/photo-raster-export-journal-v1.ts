/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportBatchV1 } from '../controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalForProfileV1, normalizePhotoRasterExportJournalForProfileV1,
	type PhotoRasterExportBindingV1, type PhotoRasterExportJournalV1 } from './internal/photo-raster-export-journal-kernel-v1.ts';
export { PHOTO_RASTER_EXPORT_SIDECAR_MAXIMUM_BYTES_V1, PHOTO_RASTER_EXPORT_JOURNAL_MAXIMUM_BYTES_V1,
	photoRasterExportJournalKeyV1, normalizePhotoRasterExportBindingV1, normalizePhotoRasterExportDownloadAckV1,
	normalizePhotoRasterExportSidecarAckV1, isPhotoRasterExportMemberCompleteV1 } from './internal/photo-raster-export-journal-kernel-v1.ts';
export type { PhotoRasterExportBindingV1, PhotoRasterExportJournalV1, PhotoRasterExportJournalMemberV1,
	PhotoRasterExportDownloadAckV1, PhotoRasterExportSidecarAckV1 } from './internal/photo-raster-export-journal-kernel-v1.ts';

export function createPhotoRasterExportJournalV1(plan: Readonly<PhotoRasterExportBatchV1>, options: Readonly<{
	catalogId: string; filenameTemplate: string; bindings: readonly Readonly<PhotoRasterExportBindingV1>[];
}>): Readonly<PhotoRasterExportJournalV1> {
	return createPhotoRasterExportJournalForProfileV1('legacy2', plan, options);
}
/** Permanent Journal1/Output1 boundary remains strict. */
export function normalizePhotoRasterExportJournalV1(value: unknown): Readonly<PhotoRasterExportJournalV1> {
	return normalizePhotoRasterExportJournalForProfileV1('legacy2', value);
}
