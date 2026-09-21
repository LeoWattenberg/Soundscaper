/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OwnedMediaAssetPublication } from
	'../common/editor/storage/media-asset-write-contract.ts';

interface DesktopPublicationBodyIdentity {
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

/** Admit only a committed body whose owned publication still binds the same bytes. */
export function matchesFramescaperDesktopPublicationIdentity(
	publication: OwnedMediaAssetPublication,
	body: DesktopPublicationBodyIdentity,
): boolean {
	return Boolean(publication && typeof publication === 'object'
		&& typeof publication.discardIfCurrent === 'function'
		&& publication.metadata.sourceId === body.storageKey
		&& publication.metadata.mimeType === body.mimeType
		&& publication.metadata.size === body.byteLength
		&& publication.metadata.sha256 === body.sha256);
}
