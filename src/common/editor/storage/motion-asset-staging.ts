/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMotionAsset, type MotionAsset } from '../motion-asset.ts';
import { motionInteger, motionRecord } from '../motion-values.ts';
import { deleteByIndex, readCursorPage, request, transact } from './indexeddb-backend.ts';

const LEASE_MILLISECONDS = 86_400_000;
const PAGE_SIZE = 64;
interface StageRecord { readonly key: string; readonly asset: MotionAsset; readonly expiresAt: number }

export function motionAssetStageRecord(key: string, asset: MotionAsset): StageRecord {
	return { key, asset, expiresAt: Date.now() + LEASE_MILLISECONDS };
}

/** Chunk write and lease renewal share a transaction with orphan collection. */
export async function renewMotionAssetStage(stores: Readonly<Record<string, IDBObjectStore>>, key: string, asset: MotionAsset): Promise<void> {
	const value: unknown = await request(stores.staging.get(key));
	if (value === undefined) throw new Error('Motion asset staging is missing; retry the import.');
	const stage = readStage(value);
	if (stage.key !== key || JSON.stringify(stage.asset) !== JSON.stringify(asset)) throw new Error('Motion asset staging identity changed.');
	if (stage.expiresAt <= Date.now()) throw new Error('Motion asset staging expired; retry the import.');
	await request(stores.staging.put(motionAssetStageRecord(key, asset)));
}

/** A committed body no longer has a staging marker, so late rollback is harmless. */
export async function discardMotionAssetStage(stores: Readonly<Record<string, IDBObjectStore>>, key: string): Promise<void> {
	const value: unknown = await request(stores.staging.get(key));
	if (value === undefined) return;
	const stage = readStage(value);
	if (stage.key !== key) throw new Error('Motion asset staging identity changed.');
	const published: unknown = await request(stores.assets.get(stage.asset.storageKey));
	if (!published || typeof published !== 'object' || !('token' in published) || published.token !== key) {
		await deleteByIndex(stores.chunks.index('token'), key);
	}
	await request(stores.staging.delete(key));
}

/** Reclaim interrupted private writes in bounded pages; retain every published revision/body. */
export async function reclaimExpiredMotionStaging(database: IDBDatabase): Promise<void> {
	let afterPrimaryKey: string | undefined;
	while (true) {
		const page = await transact(database, ['staging'], 'readonly', (stores) => readCursorPage<StageRecord>(stores.staging,
			{ afterPrimaryKey, limit: PAGE_SIZE, project: (value) => readStage(value) }));
		for (const stage of page) {
			if (stage.expiresAt > Date.now()) continue;
			await transact(database, ['staging', 'chunks', 'assets'], 'readwrite', async (stores) => {
				const current: unknown = await request(stores.staging.get(stage.key));
				if (current !== undefined && readStage(current).expiresAt <= Date.now()) await discardMotionAssetStage(stores, stage.key);
			});
		}
		if (page.length < PAGE_SIZE) return;
		afterPrimaryKey = page.at(-1)?.key;
	}
}

function readStage(value: unknown): StageRecord {
	const record = motionRecord(value, ['key', 'asset', 'expiresAt'], 'motion asset staging');
	if (typeof record.key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(record.key)) {
		throw new Error('Motion asset staging token is corrupt.');
	}
	return { key: record.key, asset: normalizeMotionAsset(record.asset), expiresAt: motionInteger(record.expiresAt, 'staging expiry') };
}
