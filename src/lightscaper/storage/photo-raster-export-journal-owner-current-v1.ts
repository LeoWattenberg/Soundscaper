/* SPDX-License-Identifier: AGPL-3.0-only */
import { PhotoRasterExportJournalOwnerKernelV1, type PhotoRasterExportJournalSettingsV1 } from './internal/photo-raster-export-journal-owner-kernel-v1.ts';
import type { PhotoRasterExportJournalCurrentV1 } from './photo-raster-export-journal-current-v1.ts';

/** Current fresh image/JSON delivery requires this caller's positive native
 * claim ACK. Matching readback is retained only for explicit recovery review. */
export class PhotoRasterExportJournalOwnerCurrentV1 extends PhotoRasterExportJournalOwnerKernelV1 {
	constructor(settings: PhotoRasterExportJournalSettingsV1, catalogId: string) { super('current1', settings, catalogId); }
	override get current(): Readonly<PhotoRasterExportJournalCurrentV1> | null { return super.current; }
	override load(): Promise<Readonly<PhotoRasterExportJournalCurrentV1> | null> { return super.load(); }
	override create(value: unknown): Promise<Readonly<PhotoRasterExportJournalCurrentV1>> { return super.create(value); }
	override started(jobId: string, reviewedRetry = false): Promise<Readonly<PhotoRasterExportJournalCurrentV1>> { return super.started(jobId, reviewedRetry); }
	override replaceCompleted(value: unknown): Promise<Readonly<PhotoRasterExportJournalCurrentV1>> { return super.replaceCompleted(value); }
	override committed(...args: Parameters<PhotoRasterExportJournalOwnerKernelV1['committed']>): Promise<Readonly<PhotoRasterExportJournalCurrentV1>> { return super.committed(...args); }
	override sidecarStarted(jobId: string, reviewedRetry = false): Promise<Readonly<PhotoRasterExportJournalCurrentV1>> { return super.sidecarStarted(jobId, reviewedRetry); }
	override sidecarCommitted(...args: Parameters<PhotoRasterExportJournalOwnerKernelV1['sidecarCommitted']>): Promise<Readonly<PhotoRasterExportJournalCurrentV1>> { return super.sidecarCommitted(...args); }
}
