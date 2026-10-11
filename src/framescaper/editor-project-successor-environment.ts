/* SPDX-License-Identifier: AGPL-3.0-only */
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import { assertFramescaperSuccessorLine } from './editor-project-successor.ts';
import { createFramescaperSuccessorRuntime } from './editor-project-successor-runtime.ts';
import { FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE } from './editor-project-successor-runtime-profile.ts';
import { openFramescaperCompositionLinkOwnerRepository } from './editor-composition-link-owner-repository.ts';
import { openFramescaperSuccessorRepository } from './editor-project-successor-repository.ts';
import { createFramescaperSuccessorStoreAdapter } from './editor-project-successor-store-adapter.ts';
import { hydrateFramescaperSuccessorArchive } from './editor-project-successor-hydration.ts';
import { createFramescaperSuccessorPlayback } from './editor-project-successor-playback.ts';
const ENVIRONMENTS = new WeakSet<object>();
export type FramescaperSuccessorEnvironment = Awaited<ReturnType<typeof createFramescaperSuccessorEnvironment>>;
/** Separate media materializations and canonical owner authority; baseline storage is never opened. */
export async function createFramescaperSuccessorEnvironment(options: Readonly<{ line: unknown; storeOptions?: AudioEditorProjectStoreOptions }>) {
	assertFramescaperSuccessorLine(options.line); const settings = options.storeOptions ?? {};
	for (const field of ['databaseName', 'projectStorageProfile', 'repositoryFactory']) if (Object.hasOwn(settings, field)) throw new TypeError('Successor storage namespace overrides are not allowed.');
	const runtime = createFramescaperSuccessorRuntime(options);
	const media = new AudioEditorProjectStore({ ...settings, projectStorageProfile: FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE, memoryFallback: false });
	let owners: Awaited<ReturnType<typeof openFramescaperCompositionLinkOwnerRepository>> | null = null;
	let custody: Awaited<ReturnType<typeof openFramescaperSuccessorRepository>> | null = null;
	try {
		await media.ready(); if (!media.getStatus().persistent) throw new Error('The successor editor requires durable media storage.');
		owners = await openFramescaperCompositionLinkOwnerRepository({ line: options.line, ...(settings.indexedDB ? { indexedDB: settings.indexedDB } : {}) });
		custody = await openFramescaperSuccessorRepository({ line: options.line, ...(settings.indexedDB ? { indexedDB: settings.indexedDB } : {}) });
		const archiveRepository = custody; const ownerRepository = owners;
		const hydrated = new Map<string, string>();
		const controllerStore = createFramescaperSuccessorStoreAdapter({ media, owners, runtime, prepareOpen: async (id, signal) => {
			const record = await archiveRepository.load(id);
			if (record) {
				if (hydrated.get(id) === record.archiveDigest) return;
				await hydrateFramescaperSuccessorArchive(record, media, signal); hydrated.set(id, record.archiveDigest);
			} else if (!hydrated.has(id)) {
				const { restoreFramescaperSuccessorPortableCustody } = await import('./editor-project-successor-portable-import.ts');
				const digest = await restoreFramescaperSuccessorPortableCustody(id, media, { line: options.line, signal, ...(settings.indexedDB ? { indexedDB: settings.indexedDB } : {}) });
				if (digest) hydrated.set(id, digest);
			}
		} });
		let closed = false;
		const environment = Object.freeze({ runtime, store: media, controllerStore, owners, custody, playback: createFramescaperSuccessorPlayback(media),
			createProjectIfAbsent: controllerStore.createProjectIfAbsent.bind(controllerStore),
			async close() { if (closed) return; closed = true; archiveRepository.close(); await ownerRepository.close(); await media.close(); },
		});
		ENVIRONMENTS.add(environment); return environment;
	} catch (error) {
		custody?.close(); const failures: unknown[] = [];
		for (const close of [() => owners?.close(), () => media.close()]) { try { await close(); } catch (failure) { failures.push(failure); } }
		if (failures.length) throw new AggregateError([error, ...failures], 'Successor environment construction and cleanup failed.', { cause: error }); throw error;
	}
}
export function assertFramescaperSuccessorEnvironment(value: unknown): FramescaperSuccessorEnvironment {
	if (!value || typeof value !== 'object' || !ENVIRONMENTS.has(value)) throw new TypeError('An exact successor environment is required.');
	return value as FramescaperSuccessorEnvironment;
}
