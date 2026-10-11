/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import type { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import { captureMediaAssetOpfsDirectoryBinding, consumeMediaAssetOpfsDirectoryBinding,
	matchesMediaAssetOpfsDirectoryBinding, readMediaAssetOpfsDirectoryBinding, withMediaAssetOpfsStartupNamespace,
	type MediaAssetNonBinaryDatabaseProfile, type MediaAssetOpfsDirectoryBindingAdmission,
	type MediaAssetOpfsStartupNamespace } from './media-asset-opfs-startup-namespace.ts';
import { consumeMediaAssetPathLeaseIfCurrent, isMediaAssetPathLeaseAdmissionError,
	readMediaAssetPathLeaseSnapshot, type MediaAssetPathLeaseSnapshot } from './media-asset-path-staging.ts';
import { MEDIA_ASSET_STAGING_STATE_KEY, MEDIA_ASSET_STAGING_STORE_NAME,
	type MediaAssetStagingLeaseRecord } from './media-asset-staging-schema.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { RetentionSessionGuard } from './retention-session-guard.ts';

interface StartupRequest {
	readonly database: IDBDatabase | null;
	readonly factory: IDBFactory;
	readonly opfs: OpfsRepository;
	readonly sessionGuard: RetentionSessionGuard | null;
	readonly lifecycle: MediaAssetLifecycleCoordinator;
	readonly nonBinaryProfiles: readonly MediaAssetNonBinaryDatabaseProfile[];
}

type Lease = Readonly<MediaAssetStagingLeaseRecord>;
type Disposition = 'remove' | 'committed' | 'protected';
const PATH_STORES = ['sources', 'mediaAssets', 'videoDerivatives', 'videoDerivativeCacheEntries', MEDIA_ASSET_STAGING_STORE_NAME];

/** Retire only complete, stopped-owner path evidence after genuine exact absence. */
export async function reconcileMediaAssetOpfsStartup(input: StartupRequest): Promise<boolean> {
	const { database, factory, opfs, sessionGuard, lifecycle, nonBinaryProfiles } = input;
	if (!database || !sessionGuard) return false;
	// Latch synchronously: an admitted hash without a path is already legitimate work.
	const maintenance = lifecycle.tryBeginIdleMaintenance();
	if (!maintenance) return false;
	try {
		const sole = await sessionGuard.withStartupSoleSession(database, async inspect => {
			const namespace = await withMediaAssetOpfsStartupNamespace(factory, database, nonBinaryProfiles, async scope => {
				if (!await ownersCurrent(scope, inspect)) return false;
				let snapshot: MediaAssetPathLeaseSnapshot;
				try {
					snapshot = await transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', stores =>
						readMediaAssetPathLeaseSnapshot(stores[MEDIA_ASSET_STAGING_STORE_NAME]!));
				} catch (error) {
					if (isMediaAssetPathLeaseAdmissionError(error)) return false;
					throw error;
				}
				if (!distinctLeases(snapshot.leases)) return false;
				if (!snapshot.leases.length) return await scope.unchanged();
				// Unbound historical streamed leases cannot acquire a new physical owner.
				const bindings = await transact(database, 'settings', 'readonly', async stores => {
					const rows = [];
					for (const lease of snapshot.leases) rows.push(await readMediaAssetOpfsDirectoryBinding(stores.settings!, lease));
					return rows;
				});
				if (bindings.some(binding => !binding)) return false;
				const directory = await opfs.directory();
				const admission = directory && await captureMediaAssetOpfsDirectoryBinding(directory);
				if (!admission) return false;
				for (const binding of bindings) if (!binding || !await matchesMediaAssetOpfsDirectoryBinding(admission, binding)) return false;
				const plan: Array<Readonly<{ lease: Lease; disposition: Disposition }>> = [];
				// Admit every candidate before deleting any prefix of the bounded inventory.
				for (const lease of snapshot.leases) {
					const disposition = await readDisposition(scope, database, lease);
					if (disposition === 'protected') return false;
					plan.push({ lease, disposition });
				}
				for (const { lease, disposition } of plan) {
					if (!await scope.unchanged() || !await ownersCurrent(scope, inspect)
						|| !await leaseCurrent(database, snapshot, lease)
						|| await readDisposition(scope, database, lease) !== disposition
						|| !await bindingCurrent(database, lease, admission) || !await scope.unchanged()) return false;
					if (disposition === 'remove') await opfs.deletePathExact(lease.path!);
					if (!await bindingCurrent(database, lease, admission)) throw new Error('The native OPFS directory witness changed during exact cleanup.');
					if (!await scope.unchanged() || !await ownersCurrent(scope, inspect)) return false;
					const consumed = await transact(database, ['mediaAssets', 'settings', MEDIA_ASSET_STAGING_STORE_NAME], 'readwrite', async stores => {
						const metadata: unknown = await request(stores.mediaAssets!.get(lease.sourceId));
						// Concurrent metadata deletion cannot erase the remaining orphan evidence.
						if (disposition === 'committed' ? !matchingMetadata(metadata, lease) : metadata !== undefined) return false;
						if (!await readMediaAssetOpfsDirectoryBinding(stores.settings!, lease)) return false;
						if (!await consumeMediaAssetPathLeaseIfCurrent(stores[MEDIA_ASSET_STAGING_STORE_NAME]!, snapshot, lease)) return false;
						if (!await consumeMediaAssetOpfsDirectoryBinding(stores.settings!, lease)) throw new Error('The native OPFS directory witness was lost before consumption.');
						return true;
					});
					if (!consumed) throw new Error('The OPFS path lease changed before exact startup consumption.');
				}
				return true;
			});
			return namespace.admitted && namespace.value;
		});
		return sole.admitted && sole.value;
	} finally { maintenance.release(); }
}

async function bindingCurrent(database: IDBDatabase, lease: Lease, admission: MediaAssetOpfsDirectoryBindingAdmission): Promise<boolean> {
	const binding = await transact(database, 'settings', 'readonly', stores => readMediaAssetOpfsDirectoryBinding(stores.settings!, lease));
	return binding !== null && await matchesMediaAssetOpfsDirectoryBinding(admission, binding);
}

async function ownersCurrent(scope: MediaAssetOpfsStartupNamespace, inspect: (database: IDBDatabase) => Promise<boolean>): Promise<boolean> {
	for (const database of scope.databases) if (!await inspect(database)) return false;
	return true;
}

async function readDisposition(scope: MediaAssetOpfsStartupNamespace, current: IDBDatabase, lease: Lease): Promise<Disposition> {
	const metadata: unknown = await transact(current, 'mediaAssets', 'readonly', stores => request(stores.mediaAssets!.get(lease.sourceId)));
	if (metadata !== undefined) return matchingMetadata(metadata, lease) ? 'committed' : 'protected';
	for (const database of scope.databases) {
		const referenced = await transact(database, PATH_STORES, 'readonly', async stores => {
			for (const name of PATH_STORES) {
				const rows = await readCursorPage(stores[name]!.index('path'), { query: lease.path!, limit: 1,
					project: (value, key) => ({ value, key }) });
				if (!rows.length) continue;
				const row = rows[0]!;
				if (database === current && name === MEDIA_ASSET_STAGING_STORE_NAME
					&& row.key === lease.key && sameRecord(row.value, lease)) continue;
				return true;
			}
			return false;
		});
		if (referenced) return 'protected';
	}
	return 'remove';
}

async function leaseCurrent(database: IDBDatabase, snapshot: MediaAssetPathLeaseSnapshot, lease: Lease): Promise<boolean> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', async stores => {
		const store = stores[MEDIA_ASSET_STAGING_STORE_NAME]!;
		const [state, row]: unknown[] = await Promise.all([request(store.get(MEDIA_ASSET_STAGING_STATE_KEY)), request(store.get(lease.key))]);
		return sameRecord(state, snapshot.state) && sameRecord(row, lease);
	});
}

function matchingMetadata(value: unknown, lease: Lease): boolean {
	if (!value || typeof value !== 'object') return false;
	try {
		return ownData(value, 'sourceId') === lease.sourceId && ownData(value, 'storage') === 'opfs' && ownData(value, 'path') === lease.path;
	} catch { return false; }
}

function distinctLeases(leases: readonly Lease[]): boolean {
	const paths = new Set<string>(), sources = new Set<string>(), keys = new Set<string>();
	for (const lease of leases) {
		if (!lease.path || paths.has(lease.path) || sources.has(lease.sourceId) || keys.has(lease.key)) return false;
		paths.add(lease.path); sources.add(lease.sourceId); keys.add(lease.key);
	}
	return true;
}

function sameRecord(value: unknown, expected: Readonly<Record<string, unknown>>): boolean {
	if (!value || typeof value !== 'object') return false;
	try {
		const keys = Reflect.ownKeys(value), wanted = Reflect.ownKeys(expected);
		return keys.length === wanted.length && wanted.every(key => keys.includes(key) && ownData(value, key) === ownData(expected, key));
	} catch { return false; }
}

function ownData(value: object, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Native stored data fields are required.');
	return descriptor.value;
}
