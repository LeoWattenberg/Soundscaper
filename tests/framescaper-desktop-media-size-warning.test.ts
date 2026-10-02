/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import type { FileSizeWarningOptions } from '../src/common/editor/controller/shared/file-size-warning.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE } from '../src/framescaper/desktop-project-library-renderer-contract.ts';
import { connectFramescaperDesktopProjectLibraryRenderer } from '../src/framescaper/desktop-project-library-renderer.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
const THRESHOLD = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;
const LARGE_BYTES = THRESHOLD + 1;
const SHA256 = 'ab'.repeat(32);

test('approved desktop media inventory permits bounded autosave only within its renderer and project', async (context) => {
	const fixture = await library(context);
	const first = project('large-project', 0);
	const warnings: number[] = [];
	const options: FileSizeWarningOptions = { confirmFileSizeWarning: async (warning) => {
		assert.equal(warning.label, 'Desktop project media');
		assert.equal(warning.thresholdBytes, THRESHOLD);
		warnings.push(warning.byteLength);
		return true;
	} };
	await fixture.renderer.publishProject({ project: first, ...options });
	await fixture.renderer.publishProjectIfCurrent(first, project('large-project', 1));
	fixture.byteLength = LARGE_BYTES - 1;
	await fixture.renderer.publishProjectIfCurrent(project('large-project', 1), project('large-project', 2));
	assert.deepEqual(warnings, [LARGE_BYTES]);
	assert.equal(fixture.finished, 3, 'unchanged and smaller automatic writes finish');
	fixture.byteLength = LARGE_BYTES + 1;
	await assert.rejects(fixture.renderer.publishProject({ project: project('large-project', 3) }),
		{ code: 'FILE_SIZE_WARNING' });
	assert.equal(fixture.begun, 3, 'automatic growth fails before main admission');
	fixture.byteLength = LARGE_BYTES;
	await assert.rejects(fixture.renderer.publishProject({ project: project('other-project', 0) }),
		{ code: 'FILE_SIZE_WARNING' });
	const otherRenderer = await fixture.reconnect();
	await assert.rejects(otherRenderer.publishProject({ project: project('large-project', 3) }),
		{ code: 'FILE_SIZE_WARNING' });
	await fixture.renderer.publishProject({ project: project('large-project', 3), ...options });
	assert.deepEqual(warnings, [LARGE_BYTES, LARGE_BYTES], 'an explicit save still asks for its own decision');
});

test('canceled or stale inventory approval is never cached or admitted to main', async (context) => {
	const fixture = await library(context);
	const stale = new Error('the selected project changed');
	let current = true;
	await assert.rejects(fixture.renderer.publishProject({
		project: project('stale-project', 0),
		assertCurrent: () => { if (!current) throw stale; },
		confirmFileSizeWarning: async () => { current = false; return true; },
	}), (error: unknown) => error === stale);
	await assert.rejects(fixture.renderer.publishProject({ project: project('stale-project', 0) }),
		{ code: 'FILE_SIZE_WARNING' });
	const controller = new AbortController();
	await assert.rejects(fixture.renderer.publishProject({
		project: project('aborted-project', 0), signal: controller.signal,
		confirmFileSizeWarning: async () => { controller.abort(); return true; },
	}), { name: 'AbortError' });
	await assert.rejects(fixture.renderer.publishProject({ project: project('aborted-project', 0) }),
		{ code: 'FILE_SIZE_WARNING' });
	await assert.rejects(fixture.renderer.publishProject({
		project: project('declined-project', 0), confirmFileSizeWarning: async () => false,
	}), { name: 'AbortError' });
	await assert.rejects(fixture.renderer.publishProject({ project: project('declined-project', 0) }),
		{ code: 'FILE_SIZE_WARNING' });
	assert.equal(fixture.begun, 0);
});

test('an automatic media publication rechecks its owner after native admission and aborts a stale write', async (context) => {
	const fixture = await library(context);
	await fixture.renderer.publishProject({ project: project('guarded-project', 0),
		confirmFileSizeWarning: async () => true });
	let current = true;
	const stale = new Error('the publication owner changed during admission');
	fixture.beforeBegin = () => { current = false; };
	await assert.rejects(fixture.renderer.publishProject({
		project: project('guarded-project', 1),
		assertCurrent: () => { if (!current) throw stale; },
	}), (error: unknown) => error === stale);
	assert.equal(fixture.finished, 1, 'the stale automatic snapshot never reaches finish');
	assert.equal(fixture.aborted, 1, 'native admission is released before rejecting');
});

function project(id: string, revision: number): FramescaperProject {
	return {
		...createFramescaperProject(PROFILE, { id, title: id, now: '2026-10-02T11:00:00.000Z',
			visualModel: { stillSources: [{ schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
				mimeType: 'image/png', storageKey: 'still-storage', contentSha256: SHA256,
				width: 1, height: 1, hasAlpha: true }] } }),
		revision,
	} as FramescaperProject;
}

async function library(context: TestContext) {
	const state = { byteLength: LARGE_BYTES, begun: 0, finished: 0, aborted: 0,
		metadataRevision: 0, beforeBegin: null as (() => void) | null };
	const retained = new Map<string, Readonly<{ project: FramescaperProject; bodies: readonly unknown[] }>>();
	const pending = new Map<string, Readonly<{ project: FramescaperProject; bodies: readonly unknown[] }>>();
	const store = createFramescaperProjectStore(PROFILE, {
		indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER }),
			persisted: async () => true, persist: async () => true } as StorageManager,
	});
	await store.ready();
	context.after(() => store.close());
	const shadow = new Map<string, Readonly<{ current: FramescaperProject;
		revisions: readonly Readonly<{ revision: number; project: FramescaperProject }>[] }>>();
	Object.defineProperties(store, {
		projectRepository: { enumerable: true, value: {
			load: (id: string, options: Readonly<{ revision?: number }> = {}) => options.revision === undefined
				? shadow.get(id)?.current ?? null
				: shadow.get(id)?.revisions.find(({ revision }) => revision === options.revision)?.project ?? null,
			listRevisions: (id: string) => shadow.get(id)?.revisions ?? [],
			restore: (id: string, snapshot: Readonly<{ current: FramescaperProject;
				revisions: readonly Readonly<{ revision: number; project: FramescaperProject }>[] }>) => {
				shadow.set(id, structuredClone(snapshot));
			},
			delete: (id: string) => { shadow.delete(id); },
		} },
		getMediaAssetMetadata: { value: (key: string) => ({ sourceId: key, mimeType: 'image/png',
			size: state.byteLength, sha256: SHA256, kind: 'still' }) },
		loadMediaAsset: { value: () => { throw new Error('main already owns the exact retained bodies'); } },
	});
	const bundle = (id: string): Data | null => {
		const entry = retained.get(id);
		if (!entry) return null;
		const document = JSON.stringify(entry.project);
		const digest = createHash('sha256').update(document).digest('hex');
		return { metadataRevision: state.metadataRevision, document, bodies: entry.bodies,
			project: { id: `entry-${id}`, projectId: id, name: entry.project.title,
				metadataFile: `entry-${id}/${String(entry.project.revision)}-${digest}.json`,
				preferredProduct: 'framescaper', updatedAtMs: 1, schemaFamily: 'framescaper',
				schemaVersion: 1, projectRevision: entry.project.revision,
				byteLength: Buffer.byteLength(document), sha256: digest } };
	};
	const api = Object.freeze({
		connect: async () => ({ ...FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE }),
		handshakeState: () => 'admitted',
		listProjects: async () => ({ metadataRevision: state.metadataRevision,
			projects: [...retained.values()].map(({ project: item }) => ({ id: item.id,
				title: item.title, revision: item.revision, updatedAt: item.updatedAt })) }),
		readProjectBundle: async (id: string) => bundle(id),
		readBodyChunk: async () => { throw new Error('an existing body does not require a range read'); },
		claimProjectWriteFence: async () => 'aa'.repeat(24),
		checkProjectWriteFence: async () => true,
		beginPublication: async (request: Readonly<{ publicationId: string; project: FramescaperProject;
			bodies: readonly unknown[] }>) => {
			state.begun += 1;
			pending.set(request.publicationId, request);
			state.beforeBegin?.();
			return { publicationId: request.publicationId, maximumChunkBytes: 4 * 1024 * 1024,
				bodyCount: request.bodies.length, requiredBodyIndexes: [] };
		},
		writePublicationChunk: async () => { throw new Error('an existing body does not require an upload'); },
		finishPublication: async ({ publicationId }: Readonly<{ publicationId: string }>) => {
			const entry = pending.get(publicationId);
			assert.ok(entry);
			retained.set(String(entry.project.id), entry);
			state.finished += 1;
			state.metadataRevision += 1;
			return bundle(String(entry.project.id));
		},
		abortPublication: async ({ publicationId }: Readonly<{ publicationId: string }>) => {
			state.aborted += 1;
			return pending.delete(publicationId);
		},
		deleteProject: async () => undefined,
		duplicateProject: async () => undefined,
	});
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	Object.defineProperty(globalThis, 'framescaperDesktop', { configurable: true, enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary: api }) }) });
	context.after(() => {
		if (prior) Object.defineProperty(globalThis, 'framescaperDesktop', prior);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
	const reconnect = async () => {
		const renderer = await connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store);
		assert.ok(renderer);
		return renderer;
	};
	const renderer = await reconnect();
	return Object.assign(state, { renderer, reconnect });
}
