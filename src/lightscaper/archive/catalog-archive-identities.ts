/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_IDENTITY_BYTES = 16 * 1024 * 1024;

/** One bounded photo identity map carries exclusive assignment without copied member IDs. */
export class PhotoCatalogArchiveIdentityLedger {
	readonly #photos = new Map<string, boolean>();
	readonly #stacks = new Set<string>();
	#bytes = 0;

	constructor(readonly maximumBytes = MAXIMUM_IDENTITY_BYTES) {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_IDENTITY_BYTES) {
			throw new RangeError('Archive identity bytes must tighten the hard identity maximum.');
		}
	}
	get photoCount(): number { return this.#photos.size; }
	get stackCount(): number { return this.#stacks.size; }
	hasPhoto(id: string): boolean { return this.#photos.has(id); }

	admitPhoto(id: string): void {
		if (this.#photos.has(id)) throw new RangeError('Photo archive contains a duplicate photo identity.');
		this.#admitBytes(id.length); this.#photos.set(id, false);
	}

	admitStack(id: string, members: readonly string[]): void {
		if (this.#stacks.has(id)) throw new RangeError('Photo archive contains a duplicate stack identity.');
		for (const member of members) {
			if (!this.#photos.has(member)) throw new ReferenceError('Photo stack references a missing archive member.');
			if (this.#photos.get(member)) throw new RangeError('Photo is already assigned to an archive stack.');
		}
		this.#admitBytes(id.length); this.#stacks.add(id);
		for (const member of members) this.#photos.set(member, true);
	}

	#admitBytes(bytes: number): void {
		if (bytes > this.maximumBytes - this.#bytes) throw new RangeError('Photo archive exceeds its bounded identity inventory.');
		this.#bytes += bytes;
	}
}
