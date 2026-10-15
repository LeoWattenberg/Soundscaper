/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportBatchCurrentV1 } from '../controller/photo-raster-export-batch-current-v1.ts';
import type { PhotoRasterExportOutputCurrentV1 } from '../controller/photo-raster-export-output-current-v1.ts';
import type { PhotoRasterExportJournalV1, PhotoRasterExportBindingV1 } from './photo-raster-export-journal-v1.ts';
import { createPhotoRasterExportJournalForProfileV1, normalizePhotoRasterExportJournalForProfileV1 } from './internal/photo-raster-export-journal-kernel-v1.ts';

export interface PhotoRasterExportJournalCurrentV1 extends Omit<PhotoRasterExportJournalV1, 'output'> {
	readonly output?: Readonly<PhotoRasterExportOutputCurrentV1>;
}
export function createPhotoRasterExportJournalCurrentV1(plan: Readonly<PhotoRasterExportBatchCurrentV1>, options: Readonly<{
	catalogId: string; filenameTemplate: string; bindings: readonly Readonly<PhotoRasterExportBindingV1>[];
}>): Readonly<PhotoRasterExportJournalCurrentV1> {
	return createPhotoRasterExportJournalForProfileV1('current3', plan, options);
}
/** Same outer Journal1 wire format, with explicit Current nested depth admission. */
export function normalizePhotoRasterExportJournalCurrentV1(value: unknown): Readonly<PhotoRasterExportJournalCurrentV1> {
	return normalizePhotoRasterExportJournalForProfileV1('current3', value);
}
