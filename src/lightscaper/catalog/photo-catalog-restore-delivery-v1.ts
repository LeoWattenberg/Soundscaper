/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { field, id, integer } from './value-validation.ts';
import { serializeLightscaperDocumentV1 } from './documents.ts';
import { serializePhotoStackV1, type PhotoStackV1 } from './photo-stack-v1.ts';
import { serializePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import type { PhotoDocumentV1 } from './types.ts';

export type PhotoCatalogRestoreDeliveredDocumentV1 = PhotoDocumentV1 | PhotoStackV1 | PhotoSmartCollectionV1;
export const PHOTO_CATALOG_RESTORE_DELIVERY_MAXIMUM_BYTES_V1 = 16 * 1024 * 1024;

/** Logical ledger bytes: one length-framed catalog ID, then length-framed kind/ID plus each 32-byte digest.
 * Native Map/object/engine overhead is separate. No source documents or recipes survive admission. */
export class PhotoCatalogRestoreDeliveryV1 {
	readonly #catalogId: string;
	readonly #maximumBytes: number;
	readonly #entries = new Map<string, Uint8Array>();
	#bytes: number;

	constructor(catalogId: string, maximumBytes = PHOTO_CATALOG_RESTORE_DELIVERY_MAXIMUM_BYTES_V1) {
		this.#catalogId = id(catalogId, 'delivery catalog ID');
		this.#maximumBytes = integer(maximumBytes, 4 + this.#catalogId.length,
			PHOTO_CATALOG_RESTORE_DELIVERY_MAXIMUM_BYTES_V1, 'delivery byte budget');
		this.#bytes = 4 + this.#catalogId.length;
	}
	get byteLength(): number { return this.#bytes; }

	admit(document: PhotoCatalogRestoreDeliveredDocumentV1): void {
		const packet = this.#packet(document);
		if (this.#entries.has(packet.key)) throw new RangeError('Duplicate restore delivery identity.');
		const bytes = 4 + packet.key.length + 32;
		if (bytes > this.#maximumBytes - this.#bytes) throw new RangeError('Restore delivery exceeds its byte budget.');
		this.#entries.set(packet.key, packet.digest); this.#bytes += bytes;
	}
	assertDelivered(document: PhotoCatalogRestoreDeliveredDocumentV1): void {
		const packet = this.#packet(document), expected = this.#entries.get(packet.key);
		if (!expected || expected.some((byte, index) => byte !== packet.digest[index])) {
			throw new TypeError('Restored document differs from its admitted delivery.');
		}
	}
	clear(): void { this.#entries.clear(); this.#bytes = 4 + this.#catalogId.length; }

	#packet(document: PhotoCatalogRestoreDeliveredDocumentV1) {
		const value = document as unknown as Readonly<Record<string, unknown>>, kind = field(value, 'kind');
		if (field(value, 'catalogId') !== this.#catalogId) throw new TypeError('Delivery belongs to another catalog.');
		const identity = id(field(value, 'id'), 'delivery identity');
		const text = kind === 'photo' ? serializeLightscaperDocumentV1(document)
			: kind === 'photo-stack' ? serializePhotoStackV1(document)
			: kind === 'photo-smart-collection' ? serializePhotoSmartCollectionV1(document) : undefined;
		if (text === undefined) throw new TypeError('Unsupported restore delivery kind.');
		return { key: `${kind}\0${identity}`, digest: sha256(new TextEncoder().encode(text)) };
	}
}
