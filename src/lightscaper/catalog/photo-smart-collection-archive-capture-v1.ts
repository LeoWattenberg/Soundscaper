/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { catalogTransaction } from './catalog-transaction.ts';
import { admitPhotoSmartCollectionArchiveContextRequestV1, type PhotoSmartCollectionArchiveContextV1 } from './photo-smart-collection-archive-context-v1.ts';
import { scanPhotoSmartCollectionStorageV1 } from './photo-smart-collection-audit-kernel.ts';
import { assertPhotoSmartCollectionArchiveBindingV1, assertPhotoSmartCollectionArchiveQueryV1,
	readPhotoSmartCollectionArchiveBindingV1, readPhotoSmartCollectionArchiveNextV1,
	type PhotoSmartCollectionArchiveReadBindingV1 } from './photo-smart-collection-archive-read-v1.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1 } from './photo-smart-collection-storage-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, type PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import type { PhotoSmartCollectionSignalOptionsV1 } from './photo-smart-collection-repository-types-v1.ts';

export interface PhotoSmartCollectionArchiveCaptureV1 {
	readonly context: PhotoSmartCollectionArchiveContextV1;
	readonly definitions: AsyncIterable<PhotoSmartCollectionV1>;
	/** Complete final inventory authentication must precede the destination's finish. */
	readonly verify: () => Promise<void>;
}
const encoder = new TextEncoder();

/** Initial and final audits use <=64 keys/8MiB per readonly page, one canonical
 * recipe at a time. Reserve the borrowed ordinary snapshot root (2MiB) on every
 * page, plus 528384 bytes during final verification for one caller-held recipe.
 * Scalar digests cover raw same-revision changes without retaining an inventory.
 * The caller lends the database lifetime through all source and verify awaits. */
export async function capturePhotoSmartCollectionArchiveV1(database: IDBDatabase, catalogId: string,
	options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<PhotoSmartCollectionArchiveCaptureV1> {
	const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options);
	const binding = await withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database,
		PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', stores => readPhotoSmartCollectionArchiveBindingV1(stores, admitted.catalogId, signal), signal));
	const digest = await auditInventory(database, binding, 0, admitted.signal);
	const source = new ArchiveSource(database, binding, digest, admitted.signal);
	return Object.freeze({ context: binding.context, definitions: source, verify: () => source.verify() });
}

async function auditInventory(database: IDBDatabase, binding: PhotoSmartCollectionArchiveReadBindingV1,
	retainedBytes: number, signal?: AbortSignal): Promise<string> {
	const hash = sha256.create();
	await withPhotoStackQuerySignalV1(signal, privateSignal => scanPhotoSmartCollectionStorageV1(database, {
		catalogId: binding.context.catalogId, validationRoot: null, expectedRevision: binding.context.catalogRevision, retainedBytes, signal: privateSignal,
		onContext: async (stores, context, currentSignal) => {
			assertPhotoSmartCollectionArchiveBindingV1(await readPhotoSmartCollectionArchiveBindingV1(stores, binding.context.catalogId, currentSignal, context), binding);
		},
		onDefinition: (document, raw) => { assertPhotoSmartCollectionArchiveQueryV1(document, raw); hashDefinition(hash, document); },
	}));
	return bytesToHex(hash.digest());
}

class ArchiveSource implements AsyncIterable<PhotoSmartCollectionV1>, AsyncIterator<PhotoSmartCollectionV1> {
	readonly #database: IDBDatabase;
	readonly #binding: PhotoSmartCollectionArchiveReadBindingV1;
	readonly #digest: string;
	readonly #signal: AbortSignal | undefined;
	readonly #hash = sha256.create();
	#claimed = false;
	#closed = false;
	#verified = false;
	#count = 0;
	#afterKey: string | null = null;
	#active: Promise<unknown> | null = null;
	constructor(database: IDBDatabase, binding: PhotoSmartCollectionArchiveReadBindingV1, digest: string, signal?: AbortSignal) {
		this.#database = database; this.#binding = binding; this.#digest = digest; this.#signal = signal;
	}
	[Symbol.asyncIterator](): AsyncIterator<PhotoSmartCollectionV1> {
		if (this.#claimed) throw new TypeError('Archive saved collection source can only be consumed once.');
		this.#claimed = true; return this;
	}
	next(): Promise<IteratorResult<PhotoSmartCollectionV1>> {
		if (this.#active !== null) return Promise.reject(new TypeError('Archive saved collection source has pending work.'));
		if (this.#closed) return Promise.resolve({ done: true, value: undefined });
		return this.#own(async () => {
			const document = await withPhotoStackQuerySignalV1(this.#signal, signal =>
				readPhotoSmartCollectionArchiveNextV1(this.#database, this.#binding, this.#afterKey, signal));
			if (this.#closed) return { done: true, value: undefined };
			if (document === null) {
				this.#assertDelivered(); this.#closed = true; return { done: true, value: undefined };
			}
			if (++this.#count > (this.#binding.context.state?.collectionCount ?? 0)) throw new TypeError('Archive delivered recipe count exceeds its snapshot.');
			hashDefinition(this.#hash, document);
			this.#afterKey = photoSmartCollectionKeyV1(document.catalogId, document.id);
			return { done: false, value: document };
		});
	}
	async return(): Promise<IteratorResult<PhotoSmartCollectionV1>> {
		this.#closed = true;
		await this.#active;
		return { done: true, value: undefined };
	}
	verify(): Promise<void> {
		if (this.#active !== null) return Promise.reject(new TypeError('Archive saved collection source has pending work.'));
		if (this.#verified) return Promise.reject(new TypeError('Archive saved collection verification was already consumed.'));
		return this.#own(async () => {
			this.#assertDelivered();
			const current = await auditInventory(this.#database, this.#binding, PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes, this.#signal);
			if (current !== this.#digest) throw new TypeError('Archive saved collection snapshot changed after delivery.');
			this.#verified = true; this.#closed = true;
		});
	}
	#assertDelivered(): void {
		if (this.#count !== (this.#binding.context.state?.collectionCount ?? 0)) throw new TypeError('Archive saved collection delivery count is incomplete.');
		if (bytesToHex(this.#hash.clone().digest()) !== this.#digest) throw new TypeError('Archive saved collection snapshot digest changed during delivery.');
	}
	#own<Result>(run: () => Promise<Result>): Promise<Result> {
		// Latch before a borrowed native port can reenter through instrumentation.
		const operation = Promise.resolve().then(run).finally(() => { this.#active = null; });
		this.#active = operation; return operation;
	}
}

function hashDefinition(hash: ReturnType<typeof sha256.create>, document: PhotoSmartCollectionV1): void {
	const bytes = encoder.encode(JSON.stringify(document)), length = new Uint8Array(4);
	new DataView(length.buffer).setUint32(0, bytes.byteLength, true);
	hash.update(length); hash.update(bytes);
}
