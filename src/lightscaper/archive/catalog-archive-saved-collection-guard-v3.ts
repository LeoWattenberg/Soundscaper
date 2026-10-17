/* SPDX-License-Identifier: AGPL-3.0-only */

import { validatePhotoSmartCollectionReferencesV1 } from '../catalog/photo-smart-collection-read-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, type PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';

/** Borrow normalized root/recipes; retain <=10000 bounded ASCII IDs and no recipe aggregate. */
export class PhotoCatalogArchiveSavedCollectionGuardV3 {
	readonly #ids = new Set<string>();
	readonly #expected: number;
	constructor(readonly catalog: PhotoCatalogRootV1, state: Readonly<PhotoSmartCollectionsStateV1> | null) {
		const retained = state === null ? null : normalizePhotoSmartCollectionsStateV1(state);
		if (retained !== null && retained.catalogId !== catalog.id) throw new RangeError('Saved collection state belongs to a different archive catalog.');
		this.#expected = retained?.collectionCount ?? 0;
		if (catalog.collections.length + this.#expected > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) {
			throw new RangeError('Combined archive collection count exceeds its 10000 collection budget.');
		}
	}
	get count(): number { return this.#ids.size; }
	admit(definition: PhotoSmartCollectionV1): void {
		const key = id(definition.id, 'saved archive collection ID');
		if (definition.catalogId !== this.catalog.id) throw new RangeError('Saved collection belongs to a different archive catalog.');
		if (this.#ids.has(key)) throw new RangeError('Photo archive contains a duplicate saved collection identity.');
		if (this.#ids.size >= this.#expected) throw new RangeError('Saved collection archive exceeds its physical state count.');
		validatePhotoSmartCollectionReferencesV1(definition, this.catalog);
		this.#ids.add(key);
	}
	finish(): void {
		if (this.#ids.size !== this.#expected) throw new RangeError('Saved collection archive differs from its physical state count.');
	}
}
