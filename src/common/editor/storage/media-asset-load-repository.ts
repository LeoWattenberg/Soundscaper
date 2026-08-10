/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import { hasMalformedMediaContentProvenance } from './media-content-provenance.ts';
import type { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import type { BlobLike, StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

const MISSING_MEDIA_MESSAGE = 'The requested local media asset is missing.';

export interface MediaAssetLoadOptions {
	readonly signal?: AbortSignal;
}

export interface MediaAssetBodyLoader {
	load(
		record: StorageRecord,
		missingMessage: string,
		options?: MediaAssetLoadOptions,
	): Promise<BlobLike>;
}

/** Lifecycle-fenced retained-media loads with provenance and size validation. */
export class MediaAssetLoadRepository {
	readonly #port: StorageRepositoryPort;
	readonly #loader: MediaAssetBodyLoader;
	readonly #lifecycle: MediaAssetLifecycleCoordinator;

	constructor(
		port: StorageRepositoryPort,
		loader: MediaAssetBodyLoader,
		lifecycle: MediaAssetLifecycleCoordinator,
	) {
		this.#port = port;
		this.#loader = loader;
		this.#lifecycle = lifecycle;
	}

	load(
		sourceId: string,
		options: MediaAssetLoadOptions = {},
	): Promise<BlobLike | null> {
		const registration = this.#lifecycle.register();
		const cancellation = linkedAbortController(options.signal);
		const operation = this.#load(sourceId, cancellation.signal);
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

	async #load(sourceId: string, signal: AbortSignal): Promise<BlobLike | null> {
		const id = nonEmptyString(sourceId);
		throwIfAborted(signal);
		const database = await this.#port.database();
		throwIfAborted(signal);
		const record = await this.#read(id, database, signal);
		if (!record) return null;

		const expectedSize = mediaContentSize(record);
		const loaded = await this.#loader.load(record, MISSING_MEDIA_MESSAGE, { signal });
		throwIfAborted(signal);
		if (loaded.size !== expectedSize) throw new Error(MISSING_MEDIA_MESSAGE);
		return loaded;
	}

	async #read(
		sourceId: string,
		database: IDBDatabase | null,
		signal?: AbortSignal,
	): Promise<StorageRecord | null> {
		const current = !database
			? storageRecord(this.#port.memory.mediaAssets.get(sourceId))
			: await transact(database, 'mediaAssets', 'readonly', async ({ mediaAssets }) => (
				storageRecord(await request(mediaAssets.get(sourceId)))
			));
		throwIfAborted(signal);
		if (!current) return null;
		if (current.sourceId !== sourceId) throw new Error(MISSING_MEDIA_MESSAGE);
		if (hasMalformedMediaContentProvenance(current)) throw new Error(MISSING_MEDIA_MESSAGE);
		return clone(current);
	}
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
