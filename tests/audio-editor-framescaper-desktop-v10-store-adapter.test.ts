/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperDesktopProjectStoreV10Adapter,
} from '../src/framescaper/desktop-project-library-v10-store-adapter.ts';
import type {
	FramescaperDesktopProjectLibraryV10Renderer,
} from '../src/framescaper/desktop-project-library-v10-renderer.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createFramescaperProjectV18, type FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';

test('web composition returns the exact local V18 store with no wrapper authority', () => {
	const local = localStoreFixture();
	assert.equal(createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: local.store, desktopProjectLibrary: null },
	), local.store);
});

test('load always refreshes main and keeps revision witnesses private', async () => {
	const local = localStoreFixture();
	const project = projectFixture({ id: 'authoritative-load', revision: 4 });
	const calls: string[] = [];
	const renderer = rendererFixture({
		readProject: async (projectId) => {
			calls.push(`main-read:${projectId}`);
			local.seed(project);
			return structuredClone(project);
		},
	});
	const store = createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: local.store, desktopProjectLibrary: renderer.api },
	);

	assert.deepEqual(await store.loadProject(String(project.id)), project);
	assert.deepEqual(await store.loadProject(String(project.id)), project);
	assert.deepEqual(calls, ['main-read:authoritative-load', 'main-read:authoritative-load']);
	assert.deepEqual(renderer.readCalls, [
		{ projectId: 'authoritative-load', hasSignal: false },
		{ projectId: 'authoritative-load', hasSignal: false },
	]);
	assert.deepEqual(Reflect.ownKeys(store), Reflect.ownKeys(local.store));
	assert.equal(JSON.stringify(store).includes('metadataRevision'), false);
	assert.equal(JSON.stringify(store).includes('projectSha256'), false);
	assert.equal(Object.hasOwn(store, 'desktopProjectLibrary'), false);

	const revision = await store.loadProject(String(project.id), { revision: 4 });
	assert.deepEqual(revision, project);
	assert.equal(renderer.readCalls.length, 2);
});

test('save is main-first and uses only a renderer-held witness before local reconciliation', async () => {
	const local = localStoreFixture();
	const current = projectFixture({ id: 'main-first-save', revision: 0 });
	const project = projectFixture({ id: 'main-first-save', revision: 1, title: 'Main first' });
	local.seed(current);
	const events: string[] = [];
	const renderer = rendererFixture({
		readProject: async () => structuredClone(current),
		publishProject: async (request) => {
			events.push('main-publish');
			assert.deepEqual(await local.store.loadProject(String(project.id)), current);
			assert.deepEqual(Reflect.ownKeys(request), ['project']);
			local.seed(project);
			return structuredClone(project);
		},
	});
	const store = createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: local.store, desktopProjectLibrary: renderer.api },
	);
	await store.loadProject(String(current.id));
	const saved = await store.saveProject(project, {
		admitProjectPublication: async () => { events.push('admit'); },
		protectedLinkedOriginalSourceReferences: [],
	});

	assert.deepEqual(saved, project);
	assert.deepEqual(events, ['admit', 'main-publish']);
	assert.deepEqual(renderer.publishCalls, [{ project }]);
	assert.deepEqual(await local.store.loadProject(String(project.id)), project);
	assert.equal(local.saveCalls, 0);
});

test('save refuses a missing or stale private witness before main or local mutation', async () => {
	for (const scenario of ['missing', 'stale'] as const) {
		const local = localStoreFixture();
		const current = projectFixture({ id: `refuse-${scenario}`, revision: 2 });
		const project = projectFixture({ id: `refuse-${scenario}`, revision: 3 });
		local.seed(current);
		const renderer = rendererFixture({
			readProject: async () => scenario === 'stale'
				? projectFixture({ id: String(project.id), revision: 1 })
				: null,
		});
		const store = createFramescaperDesktopProjectStoreV10Adapter(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			{ localStore: local.store, desktopProjectLibrary: renderer.api },
		);
		if (scenario === 'stale') await store.loadProject(String(project.id));
		await assert.rejects(store.saveProject(project), /witness|stale|authoritative.*load/iu);
		assert.equal(renderer.publishCalls.length, 0);
		assert.equal(local.saveCalls, 0);
		assert.deepEqual(await local.store.loadProject(String(project.id)), current);
	}
});

test('create is main-first, collision-safe, and consumes its private absence witness once', async () => {
	const local = localStoreFixture();
	const project = projectFixture({ id: 'desktop-create', revision: 0 });
	const events: string[] = [];
	const renderer = rendererFixture({
		readProject: async () => { events.push('main-read'); return null; },
		publishProject: async (request) => {
			events.push('main-publish');
			assert.deepEqual(Reflect.ownKeys(request), ['project']);
			assert.equal(await local.store.loadProject(String(project.id)), null);
			local.seed(project);
			return structuredClone(project);
		},
	});
	const store = createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: local.store, desktopProjectLibrary: renderer.api },
	);
	const created = await store.createProjectIfAbsent(project);
	assert.deepEqual(created, project);
	assert.deepEqual(events, ['main-read', 'main-publish']);
	assert.equal(local.createCalls, 0);
	assert.deepEqual(await local.store.loadProject(String(project.id)), project);
	await assert.rejects(store.createProjectIfAbsent(project), /already exists|absent/iu);
	assert.equal(renderer.publishCalls.length, 1);
});

test('desktop mode rejects local-only delete and duplication while delegating non-project store ownership', async () => {
	const local = localStoreFixture();
	const renderer = rendererFixture({ readProject: async () => null });
	const store = createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: local.store, desktopProjectLibrary: renderer.api },
	);
	await assert.rejects(store.deleteProject('project'), /V10.*delete.*unavailable/iu);
	await assert.rejects(store.duplicateProject('project'), /V10.*duplication.*unavailable/iu);
	assert.equal(local.deleteCalls, 0);
	assert.equal(local.duplicateCalls, 0);
	assert.deepEqual(await store.listProjects(), []);
	assert.equal(store.getStatus(), local.status);
	assert.equal(await store.saveSetting('key', 'value'), 'setting:value');
	assert.deepEqual(local.settingCalls, [['key', 'value']]);
	assert.equal(store.preservesProjectsOnClear(), true);
	assert.equal(store.prepareProjectHandoff, undefined);
});

interface RendererOverrides {
	readonly readProject?: (projectId: string) => Promise<FramescaperProjectV18 | null>;
	readonly publishProject?: (request: Readonly<{ project: unknown }>) => Promise<FramescaperProjectV18>;
}

function rendererFixture(overrides: RendererOverrides = {}) {
	const readCalls: Array<{ projectId: string; hasSignal: boolean }> = [];
	const publishCalls: Array<Readonly<{ project: FramescaperProjectV18 }>> = [];
	const api: FramescaperDesktopProjectLibraryV10Renderer = Object.freeze({
		async readProject(projectId, options = {}) {
			readCalls.push({ projectId, hasSignal: options.signal !== undefined });
			return overrides.readProject?.(projectId) ?? null;
		},
		async publishProject(request) {
			const record = request as unknown as Readonly<{ project: FramescaperProjectV18 }>;
			publishCalls.push({ project: structuredClone(record.project) });
			if (overrides.publishProject) return overrides.publishProject(request);
			return structuredClone(record.project);
		},
	});
	return { api, readCalls, publishCalls };
}

function localStoreFixture() {
	const projects = new Map<string, FramescaperProjectV18>();
	const status = Object.freeze({ state: 'indexeddb' });
	const settingCalls: unknown[][] = [];
	let saveCalls = 0;
	let createCalls = 0;
	let deleteCalls = 0;
	let duplicateCalls = 0;
	const store = {
		backend: 'indexeddb', maximumProjectDocumentBytes: 256 * 1024 * 1024,
		getStatus: () => status,
		ready: async () => store,
		estimateStorage: async () => ({ usage: 1, quota: Number.MAX_SAFE_INTEGER }),
		loadProject: async (projectId: string, options: { revision?: number } = {}) => {
			const project = projects.get(projectId) ?? null;
			return project && (options.revision === undefined || options.revision === project.revision)
				? structuredClone(project)
				: null;
		},
		saveProject: async (project: FramescaperProjectV18) => {
			saveCalls += 1; projects.set(String(project.id), structuredClone(project)); return project;
		},
		createProjectIfAbsent: async (project: FramescaperProjectV18) => {
			createCalls += 1;
			if (projects.has(String(project.id))) return null;
			projects.set(String(project.id), structuredClone(project)); return project;
		},
		listProjects: async () => [...projects.values()].map((project) => structuredClone(project)),
		listProjectRevisions: async () => [],
		deleteProject: async (projectId: string) => { deleteCalls += 1; projects.delete(projectId); },
		duplicateProject: async () => { duplicateCalls += 1; return null; },
		prepareProjectHandoff: async () => [],
		preservesProjectsOnClear: () => false,
		saveSetting: async (key: string, value: unknown) => {
			settingCalls.push([key, value]); return `setting:${String(value)}`;
		},
		loadSetting: async (_key: string, fallback: unknown) => fallback,
		close: async () => undefined,
	};
	return {
		store,
		status,
		settingCalls,
		get saveCalls() { return saveCalls; },
		get createCalls() { return createCalls; },
		get deleteCalls() { return deleteCalls; },
		get duplicateCalls() { return duplicateCalls; },
		seed: (project: FramescaperProjectV18) => projects.set(String(project.id), structuredClone(project)),
	};
}

function projectFixture(options: Readonly<{ id: string; revision: number; title?: string }>): FramescaperProjectV18 {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: options.id,
		title: options.title ?? options.id,
		now: '2026-08-13T12:00:00.000Z',
	});
	return { ...project, revision: options.revision };
}
