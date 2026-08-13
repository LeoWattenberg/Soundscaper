/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import type { MediaAssetStagingLease } from './media-asset-staging-repository.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import {
	MediaPublicationReconciliationError,
	sameMediaPayload,
} from './media-asset-owned-publication.ts';
import type { StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import type { VideoProxyClaimRecord } from './video-proxy-claim-repository.ts';
import {
	assertVideoProxyClaimedRowCurrent,
	assertVideoProxyClaimPublicationAvailable,
	createUnverifiedVideoProxyClaim,
	normalizeVideoProxyClaimStagingInput,
	sameVideoProxyClaim,
	type VideoProxyClaimStagingInput,
} from './video-proxy-claim-staging-record.ts';

export interface MediaAssetWritePublicationResult {
	readonly claim: Readonly<VideoProxyClaimRecord> | null;
}

/** Publish the row and optional first proxy root under the writer lease. */
export async function publishMediaAssetWrite(
	port: StorageRepositoryPort,
	record: StorageRecord,
	lease: MediaAssetStagingLease,
	database: IDBDatabase | null,
	options: Readonly<{
		signal?: AbortSignal;
		videoProxyClaim?: VideoProxyClaimStagingInput;
	}> = {},
): Promise<Readonly<MediaAssetWritePublicationResult>> {
	const sourceId = record.sourceId as string;
	const input = options.videoProxyClaim === undefined
		? null
		: normalizeVideoProxyClaimStagingInput(options.videoProxyClaim);
	if (input && input.bodyKey !== sourceId) {
		throw new Error('A new video proxy claim must root its exact streamed body key.');
	}
	throwIfAborted(options.signal);
	if (!database) {
		if (input) throw new Error('Durable storage is required for atomic video proxy body publication.');
		lease.assertInMemory();
		if (port.memory.mediaAssets.has(sourceId)) {
			throw new Error(`Immutable media asset ${sourceId} cannot be overwritten.`);
		}
		throwIfAborted(options.signal);
		lease.completeInMemory();
		try {
			port.memory.mediaAssets.set(sourceId, clone(record));
		} catch (error) {
			if (await reconcilePublication(port, record, null, null, error, null)) return Object.freeze({ claim: null });
			throw error;
		}
		return Object.freeze({ claim: null });
	}

	const claim = input ? createUnverifiedVideoProxyClaim(record, input) : null;
	let mutationStarted = false;
	try {
		await transact(database, [
			'mediaAssets',
			MEDIA_ASSET_STAGING_STORE_NAME,
		], 'readwrite', async (stores) => {
			const mediaAssets = stores.mediaAssets;
			const staging = stores[MEDIA_ASSET_STAGING_STORE_NAME];
			if (await request(mediaAssets.get(sourceId))) {
				throw new Error(`Immutable media asset ${sourceId} cannot be overwritten.`);
			}
			if (input) await assertVideoProxyClaimPublicationAvailable(
				staging,
				input,
				{ requireUnclaimedBody: true },
			);
			throwIfAborted(options.signal);
			await lease.assertInStore(staging);
			throwIfAborted(options.signal);
			mutationStarted = true;
			await request(mediaAssets.put(record));
			if (claim) await request(staging.put(claim));
			await lease.completeInStore(staging);
		});
	} catch (error) {
		if (!mutationStarted) throw error;
		if (await reconcilePublication(port, record, input, claim, error, database)) {
			return Object.freeze({ claim });
		}
		throw error;
	}
	return Object.freeze({ claim });
}

async function reconcilePublication(
	port: StorageRepositoryPort,
	record: StorageRecord,
	input: VideoProxyClaimStagingInput | null,
	claim: Readonly<VideoProxyClaimRecord> | null,
	primary: unknown,
	database: IDBDatabase | null,
): Promise<boolean> {
	let currentRow: unknown;
	let currentClaim: unknown;
	try {
		if (!database) currentRow = port.memory.mediaAssets.get(record.sourceId as string);
		else {
			({ currentRow, currentClaim } = await transact(
				database,
				['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
				'readonly',
				async ({ mediaAssets, mediaAssetStaging }) => ({
					currentRow: await request(mediaAssets.get(record.sourceId as string)),
					currentClaim: claim ? await request(mediaAssetStaging.get(claim.key)) : undefined,
				}),
			));
		}
	} catch (reconciliationError) {
		throw new MediaPublicationReconciliationError(primary, reconciliationError);
	}
	const rowMatches = input && claim
		? sameClaimedRow(currentRow, input, claim)
		: sameMediaPayload(storageRecord(currentRow), record);
	if (!claim) return rowMatches;
	const claimMatches = sameVideoProxyClaim(currentClaim, claim);
	if (rowMatches !== claimMatches) {
		throw new MediaPublicationReconciliationError(
			primary,
			new Error('Atomic video proxy row and claim reconciliation observed mixed publication state.'),
		);
	}
	return rowMatches && claimMatches;
}

function sameClaimedRow(
	value: unknown,
	input: VideoProxyClaimStagingInput,
	claim: Readonly<VideoProxyClaimRecord>,
): boolean {
	try {
		assertVideoProxyClaimedRowCurrent(value, input, claim.rowIdentity);
		return true;
	} catch {
		return false;
	}
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function storageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Media storage was cancelled.', 'AbortError');
	const error = new Error('Media storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
