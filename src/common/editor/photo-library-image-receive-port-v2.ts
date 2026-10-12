/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageReceiveRequestV1, PhotoLibraryImageReceiveOptionsV1, PhotoLibraryImageReceiveReceiptV1 } from './photo-library-image-receive-port-v1.ts';

export type PhotoLibraryImageReceiveRequestV2 = PhotoLibraryImageReceiveRequestV1;
export type PhotoLibraryImageReceiveOptionsV2 = PhotoLibraryImageReceiveOptionsV1;
export interface PhotoLibraryImageReceiveReceiptV2 extends Omit<PhotoLibraryImageReceiveReceiptV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
}
/** Current Source3 publication preserves Photo3 even when its selected recipe
 * is legacy. A positive native ACK remains imported through late settlement. */
export interface PhotoLibraryImageReceivePortV2 {
	receive(request: Readonly<PhotoLibraryImageReceiveRequestV2>, options?: Readonly<PhotoLibraryImageReceiveOptionsV2>): Promise<Readonly<PhotoLibraryImageReceiveReceiptV2>>;
}
