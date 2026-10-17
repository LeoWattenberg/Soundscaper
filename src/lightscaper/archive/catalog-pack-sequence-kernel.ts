/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentThroughV3 } from '../catalog/photo-document-through-v3.ts';
import { PHOTO_CATALOG_PACK_LIMITS as LIMITS, type PhotoCatalogPackInputForProfile, type PhotoCatalogPackDocumentProfile } from './catalog-pack-codec.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';

interface PreparedRecord<Profile extends PhotoCatalogPackDocumentProfile> { readonly input: PhotoCatalogPackInputForProfile<Profile>; readonly size: number }
const CHECK = AbortSignal.prototype.throwIfAborted;

/** One admitted lookahead record, no materialized photo list. Close seals
 * admission and joins a held next before captured iterator retirement; the
 * next/pack promise retains its own failure, while Close owns return failure. */
export class PhotoCatalogPackSequence<Profile extends PhotoCatalogPackDocumentProfile = 'legacy2'> {
	readonly #next: () => Promise<IteratorResult<PhotoCatalogPackInputForProfile<Profile>>>;
	readonly #leave: () => Promise<unknown>;
	#pending: PreparedRecord<Profile> | null = null;
	#done = false;
	#active = false;
	#closed = false;
	#reading: Promise<PreparedRecord<Profile> | null> | undefined;
	#closing: Promise<void> | undefined;

	constructor(source: Iterable<PhotoCatalogPackInputForProfile<Profile>> | AsyncIterable<PhotoCatalogPackInputForProfile<Profile>>,
		readonly identity: PhotoCatalogArchiveIdentityGuard, readonly signal: AbortSignal | undefined, readonly measure: (value: unknown) => number,
		readonly documentProfile: Profile = 'legacy2' as Profile) {
		if (documentProfile !== 'legacy2' && documentProfile !== 'current3' && documentProfile !== 'current4') throw new RangeError('Unsupported fixed photo pack sequence profile.');
		const iterate = Symbol.asyncIterator in source ? source[Symbol.asyncIterator] : source[Symbol.iterator];
		const iterator = Reflect.apply(iterate, source, []) as AsyncIterator<PhotoCatalogPackInputForProfile<Profile>> | Iterator<PhotoCatalogPackInputForProfile<Profile>>;
		const next = iterator.next, leave = iterator.return;
		if (typeof next !== 'function' || leave !== undefined && typeof leave !== 'function') throw new TypeError('A photo pack iterator is required.');
		this.#next = async () => await Reflect.apply(next, iterator, []) as IteratorResult<PhotoCatalogPackInputForProfile<Profile>>;
		this.#leave = async () => leave === undefined ? undefined : await Reflect.apply(leave, iterator, []);
	}

	async nextPack(): Promise<AsyncIterable<PhotoCatalogPackInputForProfile<Profile>> | null> {
		this.#check();
		if (this.#active) throw new Error('Drain the previous photo pack before requesting another.');
		this.#active = true;
		try {
			this.#pending ??= await this.#readNext();
			if (!this.#pending) { this.#active = false; return null; }
			return this.#records();
		} catch (error) { this.#active = false; throw error; }
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = (async () => {
			try { await this.#reading; } catch { /* The read promise owns its exact outcome. */ }
			this.#pending = null;
			if (!this.#done) await this.#leave();
			this.#done = true;
		})();
		return this.#closing;
	}

	async *#records(): AsyncGenerator<PhotoCatalogPackInputForProfile<Profile>> {
		let size = 8, count = 0;
		try {
			while (this.#pending) {
				this.#check();
				if (count >= LIMITS.maximumRecords || size + this.#pending.size > LIMITS.maximumPackBytes) break;
				const prepared = this.#pending;
				this.#pending = null; size += prepared.size; count++;
				yield prepared.input;
				this.#pending = await this.#readNext();
			}
		} finally { this.#active = false; }
	}

	#readNext(): Promise<PreparedRecord<Profile> | null> {
		const work = Promise.resolve().then(() => this.#read()); this.#reading = work; void work.catch(() => undefined); return work;
	}
	async #read(): Promise<PreparedRecord<Profile> | null> {
		this.#check(); if (this.#done) return null;
		const next = await this.#next(); this.#check();
		if (next.done) { this.#done = true; return null; }
		const input = record(next.value, 'photo archive input', ['photo', 'original']);
		const raw = field(input, 'photo', 'photo archive input');
		const photo = (this.documentProfile === 'current4' ? normalizePhotoDocumentCurrentV1(raw) : this.documentProfile === 'current3'
			? normalizePhotoDocumentThroughV3(raw) : normalizePhotoDocumentV1OrV2(raw)) as PhotoCatalogPackInputForProfile<Profile>['photo'];
		const currentSize = this.documentProfile !== 'legacy2' ? this.measure(photo) : null; this.#check();
		const original = canonicalMediaContentBlob(field(input, 'original', 'photo archive input'));
		if (original.size !== photo.original.byteLength) throw new RangeError('Photo original length differs from its archive reference.');
		const size = currentSize ?? this.measure(photo); this.#check(); this.identity.admit(photo);
		return { input: { photo, original }, size };
	}
	#check(): void {
		if (this.signal !== undefined) Reflect.apply(CHECK, this.signal, []);
		if (this.#closed) throw new Error('Photo pack sequence is retired.');
	}
}
