/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PhotoLibraryBackupOptionsV1 {
	readonly signal?: AbortSignal;
	readonly writable?: WritableStream<Uint8Array>;
	/** May only tighten the shared 512 MiB renderer-resident Blob maximum. */
	readonly maximumBlobBytes?: number;
}
export interface PhotoLibraryBackupResultV1 {
	readonly catalogId: string;
	readonly catalogName: string;
	readonly photoCount: number;
	readonly byteLength: number;
	/** At most one scalar cleanup notice, after the exporter finished its output. */
	readonly notices: readonly 'cleanup-failed'[];
	/** Completed output only; streaming destinations return null. */
	readonly blob: Blob | null;
}
export interface PhotoLibraryBackupPortV1 {
	backupCatalog(options?: PhotoLibraryBackupOptionsV1): Promise<PhotoLibraryBackupResultV1>;
}
