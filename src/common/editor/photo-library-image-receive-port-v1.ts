/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PhotoLibraryImageReceiveRequestV1 {
	readonly archive: Blob; readonly sourceId: string;
	/** Ordinary Source1 requires a matching real timeline or Project Bin clip;
	 * editable Source2 rejects this field. Clip effects and timing are not imported. */
	readonly imageClipId?: string;
}
export interface PhotoLibraryImageReceiveOptionsV1 { readonly signal?: AbortSignal }
/** A confirmed publication stays imported even if native custody settlement or
 * lease cleanup fails afterwards. The exact opaque failure is retained without
 * inspecting it; reopening the selected Session performs existing recovery. */
export interface PhotoLibraryImageReceiveReceiptV1 {
	readonly schemaVersion: 1; readonly status: 'imported'; readonly catalogId: string; readonly photoId: string;
	readonly originalId: string; readonly activeVersionId: string; readonly revision: 0; readonly reusedOriginal: boolean;
	readonly settlement: 'complete' | 'recovery-pending'; readonly failure?: unknown;
}
export interface PhotoLibraryImageReceivePortV1 {
	receive(request: Readonly<PhotoLibraryImageReceiveRequestV1>, options?: Readonly<PhotoLibraryImageReceiveOptionsV1>): Promise<Readonly<PhotoLibraryImageReceiveReceiptV1>>;
}
