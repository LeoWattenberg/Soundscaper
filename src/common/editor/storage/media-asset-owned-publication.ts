/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys } from '../retention.js';
import { request, transact } from './indexeddb-backend.ts';
import type { MediaAssetDisposalRepository } from './media-asset-disposal-repository.ts';
import type { OwnedMediaAssetPublication } from './media-asset-write-contract.ts';
import { mediaAssetMetadata, type StorageRecord } from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export class MediaPublicationReconciliationError extends AggregateError {
	constructor(primary: unknown, reconciliation: unknown) {
		super(
			[primary, reconciliation],
			'Media publication failed and its committed payload could not be reconciled.',
		);
		this.name = 'MediaPublicationReconciliationError';
	}
}

/** A local cleanup capability that never reveals the committed private storage identity. */
export function ownedMediaAssetPublication(
	record: StorageRecord,
	port: StorageRepositoryPort,
	disposal: MediaAssetDisposalRepository,
	opfs: OpfsRepository,
): OwnedMediaAssetPublication {
	const expected = clone(record);
	const metadata = mediaAssetMetadata(expected);
	delete metadata.path;
	return Object.freeze({
		metadata: Object.freeze(metadata),
		async discardIfCurrent() {
			if (!await detachIfCurrent(expected, port)) return false;
			const disposable = await disposal.prepare(expected);
			await opfs.deleteBinaryRecords([disposable]);
			return true;
		},
	});
}

async function detachIfCurrent(
	expected: StorageRecord,
	port: StorageRepositoryPort,
): Promise<boolean> {
	const sourceId = expected.sourceId as string;
	const database = await port.database();
	if (!database) {
		const current = storageRecord(port.memory.mediaAssets.get(sourceId));
		if (!sameOwnedPayload(current, expected)) return false;
		if (port.retentionSessionGuard?.hasOtherMemorySession()) {
			throw new Error(`Media asset ${sourceId} is retained by another open editor session.`);
		}
		assertNotDurablyReferenced(sourceId,
			[...port.memory.projects.values()],
			[...port.memory.revisions.values()]);
		port.memory.mediaAssets.delete(sourceId);
		return true;
	}
	await port.retentionSessionGuard?.reclaimStoppedSessions(database);
	return transact(database, ['projects', 'revisions', 'settings', 'mediaAssets'], 'readwrite', async (stores) => {
		const { mediaAssets } = stores;
		const current = storageRecord(await request(mediaAssets.get(sourceId)));
		if (!sameOwnedPayload(current, expected)) return false;
		const [projects, revisions, otherSession] = await Promise.all([
			request(stores.projects.getAll()),
			request(stores.revisions.getAll()),
			port.retentionSessionGuard?.hasOtherOrLostSession(stores.settings) ?? false,
		]);
		if (otherSession) {
			throw new Error(`Media asset ${sourceId} is retained by another open editor session.`);
		}
		assertNotDurablyReferenced(sourceId, projects, revisions);
		mediaAssets.delete(sourceId);
		return true;
	});
}

function assertNotDurablyReferenced(sourceId: string, projects: unknown[], revisions: unknown[]): void {
	const retained = new Set<string>();
	for (const project of projects) collectProjectStorageKeys(project, retained);
	for (const revision of revisions) collectProjectStorageKeys(storageRecord(revision)?.project, retained);
	if (retained.has(sourceId)) throw new Error(`Media asset ${sourceId} is retained by a saved project or revision.`);
}

function sameOwnedPayload(current: StorageRecord | null, expected: StorageRecord): boolean {
	if (!current
		|| current.size !== expected.size
		|| current.sha256 !== expected.sha256
		|| current.mediaContentDigestVersion !== expected.mediaContentDigestVersion
		|| current.mediaContentToken !== expected.mediaContentToken) return false;
	return sameMediaPayload(current, expected);
}

export function sameMediaPayload(current: StorageRecord | null, expected: StorageRecord): boolean {
	if (!current || current.sourceId !== expected.sourceId || current.storage !== expected.storage) return false;
	if (typeof expected.mediaChunkToken === 'string') return current.mediaChunkToken === expected.mediaChunkToken;
	return typeof expected.path === 'string' && current.path === expected.path;
}

function storageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
