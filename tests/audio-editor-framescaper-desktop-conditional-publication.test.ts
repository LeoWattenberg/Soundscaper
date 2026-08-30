/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createFramescaperDesktopProjectLibraryHandshake } from
	'../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';
import { connectFramescaperDesktopProjectLibraryRenderer } from
	'../src/framescaper/desktop-project-library-renderer.ts';
import { createFramescaperDesktopProjectStoreAdapter } from
	'../src/framescaper/desktop-project-library-store-adapter.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import {
	createFramescaperProject,
	type FramescaperProject,
} from '../src/framescaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'framescaper-desktop-conditional-publication';

test('Framescaper desktop conditional saves publish and compare against main authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-conditional-publication-'));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 972, instanceId: 'conditional-publication' },
		handshake,
		onLeaseLost: () => undefined,
		qualification: null,
	});
	const session = main.openSession(handshake);
	const store = createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		indexedDB: createInstrumentedIndexedDB(),
		preferOpfs: false,
		storageManager: persistentStorage(),
	});
	await store.ready();
	const priorDesktop = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true,
		enumerable: true,
		value: Object.freeze({
			v1: Object.freeze({ projectLibrary: framescaperBridge(session, handshake) }),
		}),
	});
	try {
		const renderer = await connectFramescaperDesktopProjectLibraryRenderer(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			store,
		);
		assert.ok(renderer);
		const adapter = createFramescaperDesktopProjectStoreAdapter(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			{ localStore: store, desktopProjectLibrary: renderer },
		);
		const base = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
			id: PROJECT_ID, title: 'Base', now: '2026-08-30T11:00:00.000Z',
		});
		const first = advance(base, 1, 'First', '2026-08-30T11:01:00.000Z');
		const concurrent = advance(first, 2, 'Concurrent', '2026-08-30T11:02:00.000Z');
		const stale = advance(concurrent, 3, 'Stale contender', '2026-08-30T11:03:00.000Z');

		assert.deepEqual(await adapter.createProjectIfAbsent(base), base);
		assert.deepEqual(await adapter.saveProjectIfCurrent(base, first), first);
		assert.deepEqual(await authoritativeProject(session, PROJECT_ID), first);

		await publishDirectly(session, concurrent, '22'.repeat(24));
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
		if (priorDesktop) Object.defineProperty(globalThis, 'framescaperDesktop', priorDesktop);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
		await store.close();
		await session.close();
		await main.close();
		await rm(root, { recursive: true, force: true });
	}
});

type FramescaperSession = ReturnType<FramescaperDesktopProjectLibraryMain['openSession']>;

function framescaperBridge(
	session: FramescaperSession,
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
	});
}

async function publishDirectly(
	session: FramescaperSession,
	project: FramescaperProject,
	publicationId: string,
): Promise<void> {
	const current = await session.readProjectBundle(String(project.id)) as Readonly<{
		metadataRevision: number;
		project: Readonly<{ projectRevision: number; sha256: string }>;
	}> | null;
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
	session: FramescaperSession,
	projectId: string,
): Promise<unknown> {
	const snapshot = await session.readProjectBundle(projectId) as Readonly<{ document: string }> | null;
	assert.ok(snapshot);
	return JSON.parse(snapshot.document) as unknown;
}

function advance(
	project: FramescaperProject,
	revision: number,
	title: string,
	updatedAt: string,
): FramescaperProject {
	return Object.freeze({ ...project, revision, title, updatedAt });
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}
