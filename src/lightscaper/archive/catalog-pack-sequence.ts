/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { measurePhotoCatalogPackRecordV1, PHOTO_CATALOG_PACK_LIMITS_V1 as LIMITS, type PhotoCatalogPackInput } from './catalog-pack.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';

interface PreparedRecord { readonly input: PhotoCatalogPackInput; readonly size: number }

/** Only one lookahead photo survives a pack boundary; originals remain Blobs. */
export class PhotoCatalogPackSequence {
	readonly #iterator: AsyncIterator<PhotoCatalogPackInput> | Iterator<PhotoCatalogPackInput>;
	#pending: PreparedRecord | null = null;
	#done = false;
	#active = false;

	constructor(source: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
		readonly identity: PhotoCatalogArchiveIdentityGuard, readonly signal?: AbortSignal) {
		this.#iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
	}

	async nextPack(): Promise<AsyncIterable<PhotoCatalogPackInput> | null> {
		if (this.#active) throw new Error('Drain the previous photo pack before requesting another.');
		this.#pending ??= await this.#readNext();
		if (!this.#pending) return null;
		this.#active = true;
		return this.#records();
	}

	async close(): Promise<void> {
		this.#pending = null;
		if (!this.#done) await this.#iterator.return?.();
		this.#done = true;
	}

	async *#records(): AsyncGenerator<PhotoCatalogPackInput> {
		let size = 8;
		let count = 0;
		try {
			while (this.#pending) {
				if (count >= LIMITS.maximumRecords || size + this.#pending.size > LIMITS.maximumPackBytes) break;
				const prepared = this.#pending;
				this.#pending = null; size += prepared.size; count += 1;
				yield prepared.input;
				this.#pending = await this.#readNext();
			}
		} finally { this.#active = false; }
	}

	async #readNext(): Promise<PreparedRecord | null> {
		this.signal?.throwIfAborted();
		if (this.#done) return null;
		const next = await this.#iterator.next();
		this.signal?.throwIfAborted();
		if (next.done) { this.#done = true; return null; }
		const value = readClosedDomainRecord(next.value, 'photo archive input', ['photo', 'original']);
		const photo = normalizePhotoDocumentV1(readClosedDomainField(value, 'photo', 'photo archive input'));
		const original = canonicalMediaContentBlob(readClosedDomainField(value, 'original', 'photo archive input'));
		if (original.size !== photo.original.byteLength) throw new RangeError('Photo original length differs from its archive reference.');
		const size = measurePhotoCatalogPackRecordV1(photo);
		this.identity.admit(photo);
		return { input: { photo, original }, size };
	}
}
