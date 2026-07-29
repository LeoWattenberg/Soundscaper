/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';
import {
	claimedMediaContentToken,
	hasMalformedMediaContentProvenance,
	mediaContentDigestClaim,
	trustedMediaContentSha256,
	verifiedMediaContentDigest,
} from './media-content-provenance.ts';
import type { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import type { BlobLike, StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

const MISSING_MEDIA_MESSAGE = 'The requested local media asset is missing.';

export interface MediaAssetDigestLoadOptions {
	readonly signal?: AbortSignal;
	readonly backfillDigest?: boolean;
}

export interface MediaAssetDigestLoader {
	load(
		record: StorageRecord,
		missingMessage: string,
		options?: MediaAssetDigestLoadOptions,
	): Promise<BlobLike>;
}

interface ClaimedMediaAsset {
	readonly record: StorageRecord;
	readonly trustedSha256: string | null;
}

/** Lazy, generation-fenced verification for retained media written before provenance v1. */
export class MediaAssetDigestBackfill {
	readonly #port: StorageRepositoryPort;
	readonly #loader: MediaAssetDigestLoader;
	readonly #lifecycle: MediaAssetLifecycleCoordinator;

	constructor(
		port: StorageRepositoryPort,
		loader: MediaAssetDigestLoader,
		lifecycle: MediaAssetLifecycleCoordinator,
	) {
		this.#port = port;
		this.#loader = loader;
		this.#lifecycle = lifecycle;
	}

	load(
		sourceId: string,
		options: MediaAssetDigestLoadOptions = {},
	): Promise<BlobLike | null> {
		const registration = this.#lifecycle.register();
		const cancellation = linkedAbortController(options.signal);
		const operation = this.#load(sourceId, cancellation.signal, options.backfillDigest !== false);
		const settled = operation.finally(() => {
			cancellation.release();
			registration.release();
		});
		registration.attachAbort(() => {
			cancellation.abort(mediaMaintenanceAbortReason());
			return settled.then(
				() => undefined,
				() => undefined,
			);
		});
		return settled;
	}

	async #load(sourceId: string, signal: AbortSignal, backfillDigest: boolean): Promise<BlobLike | null> {
		const id = nonEmptyString(sourceId);
		throwIfAborted(signal);
		const database = await this.#port.database();
		throwIfAborted(signal);
		const claimed = backfillDigest
			? await this.#claim(id, database, signal)
			: await this.#read(id, database, signal);
		if (!claimed) return null;

		const expectedSize = mediaContentSize(claimed.record);
		const loaded = await this.#loader.load(claimed.record, MISSING_MEDIA_MESSAGE, { signal });
		throwIfAborted(signal);
		if (loaded.size !== expectedSize) throw new Error(MISSING_MEDIA_MESSAGE);
		if (claimed.trustedSha256 || !backfillDigest) return loaded;

		const content = canonicalMediaContentBlob(loaded);
		if (content.size !== expectedSize) throw new Error(MISSING_MEDIA_MESSAGE);
		const sha256 = await digestMediaContent(content, { signal });
		throwIfAborted(signal);
		await this.#publish(claimed.record, sha256, database, signal);
		return loaded;
	}

	async #read(
		sourceId: string,
		database: IDBDatabase | null,
		signal?: AbortSignal,
	): Promise<ClaimedMediaAsset | null> {
		const current = !database
			? storageRecord(this.#port.memory.mediaAssets.get(sourceId))
			: await transact(database, 'mediaAssets', 'readonly', async ({ mediaAssets }) => (
				storageRecord(await request(mediaAssets.get(sourceId)))
			));
		throwIfAborted(signal);
		if (!current) return null;
		if (current.sourceId !== sourceId) throw new Error(MISSING_MEDIA_MESSAGE);
		if (hasMalformedMediaContentProvenance(current)) throw new Error(MISSING_MEDIA_MESSAGE);
		return {
			record: clone(current),
			trustedSha256: trustedMediaContentSha256(current),
		};
	}

	async #claim(
		sourceId: string,
		database: IDBDatabase | null,
		signal?: AbortSignal,
	): Promise<ClaimedMediaAsset | null> {
		if (!database) {
			const current = storageRecord(this.#port.memory.mediaAssets.get(sourceId));
			if (!current) return null;
			if (current.sourceId !== sourceId) throw new Error(MISSING_MEDIA_MESSAGE);
			if (hasMalformedMediaContentProvenance(current)) throw new Error(MISSING_MEDIA_MESSAGE);
			const trustedSha256 = trustedMediaContentSha256(current);
			if (trustedSha256) return { record: clone(current), trustedSha256 };
			const claimed = { ...current, ...mediaContentDigestClaim(current) };
			throwIfAborted(signal);
			this.#port.memory.mediaAssets.set(sourceId, claimed);
			return { record: claimed, trustedSha256: null };
		}
		return transact(database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => {
			const current = storageRecord(await request(mediaAssets.get(sourceId)));
			if (!current) return null;
			if (current.sourceId !== sourceId) throw new Error(MISSING_MEDIA_MESSAGE);
			if (hasMalformedMediaContentProvenance(current)) throw new Error(MISSING_MEDIA_MESSAGE);
			const trustedSha256 = trustedMediaContentSha256(current);
			if (trustedSha256) return { record: clone(current), trustedSha256 };
			const claimed = { ...current, ...mediaContentDigestClaim(current) };
			throwIfAborted(signal);
			await request(mediaAssets.put(claimed));
			return { record: clone(claimed), trustedSha256: null };
		});
	}

	async #publish(
		claimed: StorageRecord,
		sha256: string,
		database: IDBDatabase | null,
		signal?: AbortSignal,
	): Promise<void> {
		const sourceId = claimed.sourceId as string;
		const claimToken = claimedMediaContentToken(claimed);
		if (!claimToken) throw new Error('The media content digest claim is invalid.');
		if (!database) {
			const current = storageRecord(this.#port.memory.mediaAssets.get(sourceId));
			if (identicalWinner(current, claimed, sha256, true)) return;
			assertClaimCurrent(current, claimed, claimToken, true);
			const verified = { ...current, ...verifiedMediaContentDigest(sha256, claimToken) };
			throwIfAborted(signal);
			this.#port.memory.mediaAssets.set(sourceId, verified);
			return;
		}
		await transact(database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => {
			const current = storageRecord(await request(mediaAssets.get(sourceId)));
			throwIfAborted(signal);
			if (identicalWinner(current, claimed, sha256, false)) return;
			assertClaimCurrent(current, claimed, claimToken, false);
			const verified = { ...current, ...verifiedMediaContentDigest(sha256, claimToken) };
			throwIfAborted(signal);
			await request(mediaAssets.put(verified));
		});
	}
}

function assertClaimCurrent(
	current: StorageRecord | null,
	claimed: StorageRecord,
	claimToken: string,
	requireBlobIdentity: boolean,
): asserts current is StorageRecord {
	if (!current
		|| claimedMediaContentToken(current) !== claimToken
		|| !sameMediaPayload(current, claimed, requireBlobIdentity)) {
		throw new Error('The retained media asset changed while its digest was being verified.');
	}
}

function identicalWinner(
	current: StorageRecord | null,
	claimed: StorageRecord,
	sha256: string,
	requireBlobIdentity: boolean,
): boolean {
	return Boolean(current
		&& trustedMediaContentSha256(current) === sha256
		&& current.mediaContentToken === claimed.mediaContentToken
		&& sameMediaPayload(current, claimed, requireBlobIdentity));
}

function sameMediaPayload(
	current: StorageRecord,
	claimed: StorageRecord,
	requireBlobIdentity: boolean,
): boolean {
	if (current.sourceId !== claimed.sourceId
		|| current.storage !== claimed.storage
		|| current.size !== claimed.size) return false;
	if (claimed.storage === 'indexeddb-media-chunks-v1') {
		return current.mediaChunkToken === claimed.mediaChunkToken
			&& current.mediaChunkBytes === claimed.mediaChunkBytes
			&& current.mediaChunkCount === claimed.mediaChunkCount;
	}
	if (claimed.storage === 'opfs') return current.path === claimed.path && typeof claimed.path === 'string';
	if (requireBlobIdentity) return current.blob === claimed.blob;
	return sameBlobShape(current.blob, claimed.blob);
}

function sameBlobShape(left: unknown, right: unknown): boolean {
	return Boolean(left && right
		&& typeof left === 'object'
		&& typeof right === 'object'
		&& 'size' in left
		&& 'size' in right
		&& left.size === right.size
		&& (!('type' in left) || !('type' in right) || left.type === right.type));
}

function mediaContentSize(record: StorageRecord): number {
	if (!Number.isSafeInteger(record.size) || Number(record.size) < 0) {
		throw new Error(MISSING_MEDIA_MESSAGE);
	}
	return Number(record.size);
}

function storageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function nonEmptyString(value: unknown): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError('A media source id is required.');
	return text;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

interface LinkedAbortController {
	readonly signal: AbortSignal;
	abort(reason: unknown): void;
	release(): void;
}

function linkedAbortController(external?: AbortSignal): LinkedAbortController {
	const controller = new AbortController();
	const abortFromExternal = (): void => { controller.abort(external?.reason); };
	let listening = false;
	if (external?.aborted) abortFromExternal();
	else if (external) {
		external.addEventListener('abort', abortFromExternal, { once: true });
		listening = true;
	}
	return {
		signal: controller.signal,
		abort: (reason) => { controller.abort(reason); },
		release: () => {
			if (!listening) return;
			listening = false;
			external?.removeEventListener('abort', abortFromExternal);
		},
	};
}

function mediaMaintenanceAbortReason(): Error {
	if (typeof DOMException === 'function') {
		return new DOMException('Media storage maintenance cancelled the retained-media read.', 'AbortError');
	}
	const error = new Error('Media storage maintenance cancelled the retained-media read.');
	error.name = 'AbortError';
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Media storage was cancelled.', 'AbortError');
	const error = new Error('Media storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
