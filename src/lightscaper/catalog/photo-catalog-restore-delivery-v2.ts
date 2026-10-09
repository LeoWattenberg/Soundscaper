/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { id, integer } from './value-validation.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2, type PhotoDocumentV2 } from './photo-document-v2.ts';
import { normalizePhotoStackV1, serializePhotoStackV1, type PhotoStackV1 } from './photo-stack-v1.ts';
import { normalizePhotoSmartCollectionV1, serializePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import type { PhotoDocumentV1 } from './types.ts';
import { PHOTO_CATALOG_RESTORE_DELIVERY_MAXIMUM_BYTES_V1 as MAXIMUM_BYTES } from './photo-catalog-restore-delivery-v1.ts';

export type PhotoCatalogRestoreDeliveredDocumentV2 = PhotoDocumentV1 | PhotoDocumentV2 | PhotoStackV1 | PhotoSmartCollectionV1;

/** Complete owning mixed documents yield only scalar identities and SHA256 digests.
 * The unchanged 16MiB ledger framing excludes native Map/engine overhead. */
export class PhotoCatalogRestoreDeliveryV2 {
	readonly #catalogId: string;
	readonly #maximumBytes: number;
	readonly #entries = new Map<string, Uint8Array>();
	#bytes: number;
	constructor(catalogId: string, maximumBytes = MAXIMUM_BYTES) {
		this.#catalogId = id(catalogId, 'delivery catalog ID');
		this.#maximumBytes = integer(maximumBytes, 4 + this.#catalogId.length, MAXIMUM_BYTES, 'delivery byte budget');
		this.#bytes = 4 + this.#catalogId.length;
	}
	get byteLength(): number { return this.#bytes; }
	admit(document: PhotoCatalogRestoreDeliveredDocumentV2): void {
		const packet = this.#packet(document);
		if (this.#entries.has(packet.key)) throw new RangeError('Duplicate restore delivery identity.');
		const bytes = 4 + packet.key.length + 32;
		if (bytes > this.#maximumBytes - this.#bytes) throw new RangeError('Restore delivery exceeds its byte budget.');
		this.#entries.set(packet.key, packet.digest); this.#bytes += bytes;
	}
	assertDelivered(document: PhotoCatalogRestoreDeliveredDocumentV2): void {
		const packet = this.#packet(document), expected = this.#entries.get(packet.key);
		if (!expected || expected.some((byte, index) => byte !== packet.digest[index])) throw new TypeError('Restored document differs from its admitted delivery.');
	}
	clear(): void { this.#entries.clear(); this.#bytes = 4 + this.#catalogId.length; }
	#packet(value: PhotoCatalogRestoreDeliveredDocumentV2) {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Delivery kind requires inert own data.');
		const kind: unknown = descriptor.value;
		const document = kind === 'photo' ? normalizePhotoDocumentV1OrV2(value)
			: kind === 'photo-stack' ? normalizePhotoStackV1(value)
			: kind === 'photo-smart-collection' ? normalizePhotoSmartCollectionV1(value) : undefined;
		if (!document) throw new TypeError('Unsupported restore delivery kind.');
		if (document.catalogId !== this.#catalogId) throw new TypeError('Delivery belongs to another catalog.');
		const text = document.kind === 'photo' ? serializePhotoDocumentV1OrV2(document)
			: document.kind === 'photo-stack' ? serializePhotoStackV1(document) : serializePhotoSmartCollectionV1(document);
		return { key: `${document.kind}\0${document.id}`, digest: sha256(new TextEncoder().encode(text)) };
	}
}
