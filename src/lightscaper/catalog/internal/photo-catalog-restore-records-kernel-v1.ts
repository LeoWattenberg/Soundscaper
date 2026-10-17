/* SPDX-License-Identifier: AGPL-3.0-only */

import { readValidatedPhotoCatalogRootV1 } from '../documents.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../photo-document-v2.ts';
import { validatePhotoCatalogReferencesV1 } from '../photo-document.ts';
import { photoMemberships, photoStorageKey, photoSummary } from '../repository-records.ts';
import type { PhotoMembershipV1, PhotoSummaryV1 } from '../repository-types.ts';
import type { PhotoDocumentV1 } from '../types.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../photo-document-current-v1.ts';
import { normalizePhotoDocumentThroughV3, type PhotoDocumentThroughV3 } from '../photo-document-through-v3.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { id, integer } from '../value-validation.ts';
import { normalizePhotoStackV1, serializePhotoStackV1, type PhotoStackV1 } from '../photo-stack-v1.ts';
import { normalizePhotoSmartCollectionV1, serializePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../photo-smart-collection-v1.ts';
import { PHOTO_CATALOG_RESTORE_DELIVERY_MAXIMUM_BYTES_V1 as MAXIMUM_BYTES } from '../photo-catalog-restore-delivery-v1.ts';
import { projectPhotoQueryRowV1, type PhotoQueryRowV1 } from '../photo-query-index-v1.ts';
import { projectPhotoQueryRowV2, type PhotoQueryRowV2 } from '../photo-query-index-v2.ts';

export { photoCatalogRestoreRootRecordsV1, photoCatalogRestoreStackRecordsV1, photoCatalogRestoreSavedCollectionRecordsV1,
	type PhotoCatalogRestoreRootRecordsV1 } from '../photo-catalog-restore-records-v1.ts';

export type PhotoCatalogRestoreProfileV1 = 'legacy2' | 'current3' | 'current4';
export type PhotoCatalogRestorePhotoForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> = Profile extends 'legacy2' ? PhotoDocumentV1 | PhotoDocumentV2 : Profile extends 'current3' ? PhotoDocumentThroughV3 : PhotoDocumentCurrentV1;
export function normalizePhotoCatalogRestoreDocumentForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, value: unknown): PhotoCatalogRestorePhotoForProfileV1<Profile> {
	assertPhotoCatalogRestoreProfileV1(profile);
	return (profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : profile === 'current3' ? normalizePhotoDocumentThroughV3(value) : normalizePhotoDocumentCurrentV1(value)) as PhotoCatalogRestorePhotoForProfileV1<Profile>;
}
export interface PhotoCatalogRestorePhotoRecordsForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> {
	readonly photo: Readonly<{ key: string; document: PhotoCatalogRestorePhotoForProfileV1<Profile> }>;
	readonly summary: PhotoSummaryV1;
	readonly memberships: readonly PhotoMembershipV1[];
	readonly queryV1: PhotoQueryRowV1 | null;
	readonly queryV2: PhotoQueryRowV2;
}

/** Complete mixed document admission precedes the unchanged metadata-only projections.
 * One serial source and its independently bounded projections are retained; no whole-heap bound. */
export function photoCatalogRestorePhotoRecordsForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, rootValue: unknown, value: unknown): PhotoCatalogRestorePhotoRecordsForProfileV1<Profile> {
	assertPhotoCatalogRestoreProfileV1(profile);
	const root = readValidatedPhotoCatalogRootV1(rootValue);
	const document = normalizePhotoCatalogRestoreDocumentForProfileV1(profile, value);
	validatePhotoCatalogReferencesV1(document, root);
	let queryV1: PhotoQueryRowV1 | null;
	try { queryV1 = projectPhotoQueryRowV1(document); }
	catch (error) {
		if (!(error instanceof RangeError) || error.message !== 'Photo query row exceeds its byte budget.') throw error;
		queryV1 = null;
	}
	return Object.freeze({ photo: Object.freeze({ key: photoStorageKey(root.id, document.id), document }),
		summary: photoSummary(document), memberships: photoMemberships(document), queryV1, queryV2: projectPhotoQueryRowV2(document) });
}

export type PhotoCatalogRestoreDeliveredDocumentForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> = PhotoCatalogRestorePhotoForProfileV1<Profile> | PhotoStackV1 | PhotoSmartCollectionV1;

/** Complete owning mixed documents yield only scalar identities and SHA256 digests.
 * The unchanged 16MiB ledger framing excludes native Map/engine overhead. */
export class PhotoCatalogRestoreDeliveryForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> {
	readonly #catalogId: string;
	readonly #maximumBytes: number;
	readonly #entries = new Map<string, Uint8Array>();
	#bytes: number;
	constructor(readonly profile: Profile, catalogId: string, maximumBytes = MAXIMUM_BYTES) {
		assertPhotoCatalogRestoreProfileV1(profile);
		this.#catalogId = id(catalogId, 'delivery catalog ID');
		this.#maximumBytes = integer(maximumBytes, 4 + this.#catalogId.length, MAXIMUM_BYTES, 'delivery byte budget');
		this.#bytes = 4 + this.#catalogId.length;
	}
	get byteLength(): number { return this.#bytes; }
	admit(document: PhotoCatalogRestoreDeliveredDocumentForProfileV1<Profile>): void {
		const packet = this.#packet(document);
		if (this.#entries.has(packet.key)) throw new RangeError('Duplicate restore delivery identity.');
		const bytes = 4 + packet.key.length + 32;
		if (bytes > this.#maximumBytes - this.#bytes) throw new RangeError('Restore delivery exceeds its byte budget.');
		this.#entries.set(packet.key, packet.digest); this.#bytes += bytes;
	}
	assertDelivered(document: PhotoCatalogRestoreDeliveredDocumentForProfileV1<Profile>): void {
		const packet = this.#packet(document), expected = this.#entries.get(packet.key);
		if (!expected || expected.some((byte, index) => byte !== packet.digest[index])) throw new TypeError('Restored document differs from its admitted delivery.');
	}
	clear(): void { this.#entries.clear(); this.#bytes = 4 + this.#catalogId.length; }
	#packet(value: PhotoCatalogRestoreDeliveredDocumentForProfileV1<Profile>) {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Delivery kind requires inert own data.');
		const kind: unknown = descriptor.value;
		const document = kind === 'photo' ? normalizePhotoCatalogRestoreDocumentForProfileV1(this.profile, value)
			: kind === 'photo-stack' ? normalizePhotoStackV1(value)
			: kind === 'photo-smart-collection' ? normalizePhotoSmartCollectionV1(value) : undefined;
		if (!document) throw new TypeError('Unsupported restore delivery kind.');
		if (document.catalogId !== this.#catalogId) throw new TypeError('Delivery belongs to another catalog.');
		const text = document.kind === 'photo' ? (this.profile === 'legacy2' ? serializePhotoDocumentV1OrV2(document) : serializePhotoDocumentCurrentV1(document))
			: document.kind === 'photo-stack' ? serializePhotoStackV1(document) : serializePhotoSmartCollectionV1(document);
		return { key: `${document.kind}\0${document.id}`, digest: sha256(new TextEncoder().encode(text)) };
	}
}

export function assertPhotoCatalogRestoreProfileV1(value: unknown): asserts value is PhotoCatalogRestoreProfileV1 {
	if (value !== 'legacy2' && value !== 'current3' && value !== 'current4') throw new RangeError('Unsupported fixed restore profile.');
}
