/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoCommandOwnerV2 } from '../../src/lightscaper/controller/photo-command-owner-v2.ts';
import { createPhotoLibraryDevelopSessionV2 } from '../../src/lightscaper/controller/photo-library-develop-session-v2.ts';
import { KeyValueRepository } from '../../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { normalizeImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

export const CURRENT_TIME = '2026-10-09T00:00:00.000Z';
export function currentRecipe(lut: unknown = { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64),
	byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }) {
	return normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut } }] });
}

/** An injected lifetime/writer host, backed by the actual current catalog and settings repositories. */
export async function currentDevelopFixture(count = 2) {
	const raw = createInstrumentedIndexedDB(), repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory,
		databaseName: 'current-develop-session', verifyOriginal: async () => undefined, verifyResources: async () => undefined });
	const photos = Array.from({ length: count }, (_, index) => photoArchiveFixture(index + 1).photo);
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.publishPhotos('catalog-1', 0, photos);
	const settings = new KeyValueRepository({ memory: getMemoryDatabase(`current-develop-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const lifetime = new AbortController(), pending = new Set<Promise<unknown>>(); let closed = false, writer = false, closing: Promise<void> | null = null;
	const hooks = { ready: async () => 'catalog-1', afterWriter: async (): Promise<void> => undefined,
		verifyPreset: async (_preset: unknown, _signal?: AbortSignal): Promise<void> => undefined };
	const calls = { ready: 0, writer: 0, resources: 0 };
	function operation<Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		if (closed) return Promise.reject(new Error('Current host is closed.'));
		const stop = new AbortController(), admitted = stop.signal;
		const sources = signal ? [lifetime.signal, signal] : [lifetime.signal];
		const subscriptions = sources.map(source => {
			const forward = () => { if (!admitted.aborted) stop.abort(source.reason); };
			source.addEventListener('abort', forward, { once: true }); if (source.aborted) forward(); return { source, forward };
		});
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const result = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		const finish = () => { pending.delete(result); for (const { source, forward } of subscriptions) source.removeEventListener('abort', forward); };
		pending.add(result); void result.then(finish, finish);
		void (async () => { admitted.throwIfAborted(); return run(admitted); })().then(resolve, reject); return result;
	}
	async function withPhoto<Result>(catalogId: string, photoId: string, signal: AbortSignal,
		run: (owner: PhotoCommandOwnerV2, signal: AbortSignal) => Promise<Result>): Promise<Result> {
		const owner = await PhotoCommandOwnerV2.open(repository, catalogId, photoId);
		try { signal.throwIfAborted(); return await run(owner, signal); } finally { await owner.close(); }
	}
	function mutate<Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		if (writer) return Promise.reject(new Error('A photo library change is already pending.'));
		writer = true; calls.writer++;
		const result = operation(async admitted => { const catalogId = await host.ready(); admitted.throwIfAborted();
			const value = await run(catalogId, admitted); await hooks.afterWriter(); return value; }, signal);
		return result.finally(() => { writer = false; });
	}
	const storage = { settings, catalog: repository, async verifyResources(preset: unknown, signal?: AbortSignal) {
		calls.resources++; return hooks.verifyPreset(preset, signal);
	} };
	const host = { repository, presetStorage: storage, async ready() { calls.ready++; return hooks.ready(); }, operation, mutate, withPhoto,
		edit<Result>(photoId: string, run: (owner: PhotoCommandOwnerV2, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) {
			return mutate((catalogId, admitted) => withPhoto(catalogId, photoId, admitted, run), signal);
		} };
	const develop = createPhotoLibraryDevelopSessionV2(host);
	function close(): Promise<void> {
		if (closing) return closing; closed = true;
		closing = Promise.allSettled([...pending]).then(async () => { await repository.close(); });
		lifetime.abort(); return closing;
	}
	return { raw, repository, settings, storage, host, develop, photos, hooks, calls, close };
}
