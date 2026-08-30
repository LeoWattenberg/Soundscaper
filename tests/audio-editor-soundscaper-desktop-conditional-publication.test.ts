/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperDesktopProjectLibraryHandshake,
} from '../desktop/soundscaper-project-library-contract.ts';
import { SoundscaperDesktopProjectLibraryMain } from
	'../desktop/soundscaper-project-library-main.ts';
import {
	connectSoundscaperDesktopProjectLibraryRenderer,
	type SoundscaperDesktopProjectLibraryShadowStore,
} from '../src/soundscaper/desktop-project-library-renderer.ts';
import { createSoundscaperDesktopProjectStoreAdapter } from
	'../src/soundscaper/desktop-project-library-store-adapter.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/soundscaper/editor-project-runtime-profile.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'desktop-conditional-publication';

test('Soundscaper desktop conditional saves publish and compare against main authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-conditional-publication-'));
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 971, instanceId: 'conditional-publication' },
		handshake,
		onLeaseLost: () => undefined,
		qualification: null,
	});
	const session = main.openSession(handshake);
	const store = createSoundscaperProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		preferOpfs: false,
		storageManager: persistentStorage(),
	});
	await store.ready();
	const priorDesktop = Object.getOwnPropertyDescriptor(globalThis, 'soundscaperProjectLibraryDesktop');
	Object.defineProperty(globalThis, 'soundscaperProjectLibraryDesktop', {
		configurable: true,
		enumerable: true,
		value: Object.freeze({ v1: soundscaperBridge(main, session, handshake) }),
	});
	try {
		const renderer = await connectSoundscaperDesktopProjectLibraryRenderer(
			SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
			{ store: store as unknown as SoundscaperDesktopProjectLibraryShadowStore },
		);
		assert.ok(renderer);
		const adapter = createSoundscaperDesktopProjectStoreAdapter(
			SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
			{ localStore: store, desktopProjectLibrary: renderer },
		);
		const base = createSoundscaperProject({
			id: PROJECT_ID, title: 'Base', now: '2026-08-30T10:00:00.000Z',
		});
		const first = advance(base, 1, 'First', '2026-08-30T10:01:00.000Z');
		const concurrent = advance(first, 2, 'Concurrent', '2026-08-30T10:02:00.000Z');
		const stale = advance(concurrent, 3, 'Stale contender', '2026-08-30T10:03:00.000Z');

		assert.deepEqual(await adapter.createScapeProjectIfAbsent(base), base);
		assert.deepEqual(await adapter.saveProjectIfCurrent(base, first), first);
		assert.deepEqual(await authoritativeProject(session, PROJECT_ID), first);

		await publishDirectly(session, concurrent, '11'.repeat(24));
		assert.equal(await adapter.saveProjectIfCurrent(first, stale), null);
		assert.deepEqual(await authoritativeProject(session, PROJECT_ID), concurrent);
		const shadowBeforeRefusedRestore = await store.loadProject(PROJECT_ID);
		assert.equal(await adapter.restoreProjectSnapshotIfCurrent(PROJECT_ID, concurrent, {
			current: first,
			revisions: [{ revision: 1, project: first }, { revision: 0, project: base }],
		}), false);
		assert.deepEqual(await store.loadProject(PROJECT_ID), shadowBeforeRefusedRestore);
		assert.deepEqual(await authoritativeProject(session, PROJECT_ID), concurrent);
	} finally {
		if (priorDesktop) Object.defineProperty(globalThis, 'soundscaperProjectLibraryDesktop', priorDesktop);
		else Reflect.deleteProperty(globalThis, 'soundscaperProjectLibraryDesktop');
		await store.close();
		await session.close();
		await main.close();
		await rm(root, { recursive: true, force: true });
	}
});

type SoundscaperSession = ReturnType<SoundscaperDesktopProjectLibraryMain['openSession']>;

function soundscaperBridge(
	main: SoundscaperDesktopProjectLibraryMain,
	session: SoundscaperSession,
	handshake: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		connect: async () => handshake,
		handshakeState: () => 'admitted',
		listProjects: () => session.listProjects(),
		readProjectBundle: (projectId: string) => session.readProjectBundle(projectId),
		readBodyChunk: (request: unknown) => session.readBodyChunk(request),
		beginPublication: (request: unknown) => session.beginPublication(request),
		writePublicationChunk: (request: unknown) => session.writePublicationChunk(request),
		finishPublication: (request: unknown) => session.finishPublication(request),
		abortPublication: (request: unknown) => session.abortPublication(request),
		deleteProject: (request: unknown) => session.deleteProject(request),
		duplicateProject: (request: unknown) => session.duplicateProject(request),
		persistNativePluginState: async (bytes: Uint8Array) => main.persistNativePluginState(bytes),
		readNativePluginState: async (bodyId: string) => main.readNativePluginState(bodyId),
	});
}

async function publishDirectly(
	session: SoundscaperSession,
	project: SoundscaperProject,
	publicationId: string,
): Promise<void> {
	const current = await session.readProjectBundle(String(project.id));
	assert.ok(current);
	await session.beginPublication({
		publicationId,
		expectedMetadataRevision: current.metadataRevision,
		expectedProject: {
			projectRevision: current.project.projectRevision,
			projectSha256: current.project.sha256,
		},
		project,
		bodies: [],
	});
	await session.finishPublication({ publicationId });
}

async function authoritativeProject(
	session: SoundscaperSession,
	projectId: string,
): Promise<unknown> {
	const snapshot = await session.readProjectBundle(projectId);
	assert.ok(snapshot);
	return JSON.parse(snapshot.document) as unknown;
}

function advance(
	project: SoundscaperProject,
	revision: number,
	title: string,
	updatedAt: string,
): SoundscaperProject {
	return Object.freeze({ ...project, revision, title, updatedAt });
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}
