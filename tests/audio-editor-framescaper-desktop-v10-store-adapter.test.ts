/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	connectFramescaperDesktopProjectLibraryV10Renderer,
	type FramescaperDesktopProjectLibraryV10ShadowStore,
} from '../src/framescaper/desktop-project-library-v10-renderer.ts';
import {
	createFramescaperDesktopProjectStoreV10Adapter,
	type FramescaperDesktopProjectStoreV10Adapter,
} from '../src/framescaper/desktop-project-library-v10-store-adapter.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	createFramescaperProjectStoreV18,
	framescaperProjectStoreAuthorityV18,
} from '../src/framescaper/editor-project-store-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createFramescaperProjectV18, type FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { FramescaperScapeArchiveV18 } from '../src/framescaper/scape-project-preservation-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PUBLICATION_ID = 'cd'.repeat(24);

test('web composition returns the exact local V18 store with no wrapper authority', async (context) => {
	const fixture = await lifecycleFixture(context, false);
	assert.equal(createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: fixture.localStore, desktopProjectLibrary: null },
	), fixture.localStore);
	assert.throws(() => createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: {} as never, desktopProjectLibrary: null },
	), /exact|local store|authority/iu);
});

test('load always refreshes main while revision loads remain shadow-local', async (context) => {
	const fixture = await lifecycleFixture(context);
	const first = projectFixture({ id: 'authoritative-load', revision: 0 });
	fixture.main.seed(first);
	assert.deepEqual(await fixture.store.loadProject(String(first.id)), first);

	const second = projectFixture({ id: String(first.id), revision: 1, title: 'Refreshed main' });
	fixture.main.seed(second);
	assert.deepEqual(await fixture.store.loadProject(String(first.id)), second);
	assert.deepEqual(fixture.main.reads, ['authoritative-load', 'authoritative-load']);
	assert.deepEqual(await fixture.localStore.loadProject(String(first.id)), second);

	assert.deepEqual(await fixture.store.loadProject(String(first.id), { revision: 0 }), first);
	assert.equal(fixture.main.reads.length, 2);
	assert.equal(Object.hasOwn(fixture.store, 'desktopProjectLibrary'), false);
	assert.equal(JSON.stringify(fixture.store).includes('projectSha256'), false);
});

test('save commits in main before exact local shadow reconciliation', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'main-first-save', revision: 0 });
	fixture.main.seed(current);
	await fixture.store.loadProject(String(current.id));
	const project = projectFixture({ id: String(current.id), revision: 1, title: 'Main first' });
	fixture.main.beforeFinish = async () => {
		assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), current);
	};

	const events: string[] = [];
	const saved = await fixture.store.saveProject(project, {
		admitProjectPublication: async () => { events.push('admitted'); },
		protectedLinkedOriginalSourceReferences: [],
	});
	assert.deepEqual(saved, project);
	assert.deepEqual(events, ['admitted']);
	assert.deepEqual(fixture.main.events.slice(-2), ['begin', 'finish']);
	assert.deepEqual(await fixture.localStore.loadProject(String(project.id)), project);
	assert.deepEqual(Reflect.ownKeys(fixture.main.lastBegin!), [
		'expectedMetadataRevision', 'expectedProject', 'project', 'bodies',
	]);
	assert.equal(JSON.stringify(fixture.main.lastBegin).includes('lease'), false);
	assert.equal(JSON.stringify(fixture.main.lastBegin).includes('path'), false);
	assert.equal(JSON.stringify(fixture.main.lastBegin).includes('callback'), false);
});

test('save refuses missing and stale private witnesses before main or local mutation', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'witness-save', revision: 0 });
	fixture.main.seed(current);
	const next = projectFixture({ id: String(current.id), revision: 1 });
	await assert.rejects(fixture.store.saveProject(next), /authoritative.*witness/iu);
	assert.equal(fixture.main.publications, 0);
	assert.equal(await fixture.localStore.loadProject(String(current.id)), null);

	await fixture.store.loadProject(String(current.id));
	const skipped = projectFixture({ id: String(current.id), revision: 2 });
	await assert.rejects(fixture.store.saveProject(skipped), /stale.*witness/iu);
	assert.equal(fixture.main.publications, 0);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), current);
});

test('create is main-first, collision-safe, and consumes its absence witness once', async (context) => {
	const fixture = await lifecycleFixture(context);
	const project = projectFixture({ id: 'desktop-create', revision: 0 });
	fixture.main.beforeFinish = async () => {
		assert.equal(await fixture.localStore.loadProject(String(project.id)), null);
	};
	assert.deepEqual(await fixture.store.createProjectIfAbsent(project), project);
	assert.deepEqual(await fixture.localStore.loadProject(String(project.id)), project);
	assert.equal(await fixture.store.createProjectIfAbsent(project), null);
	assert.equal(fixture.main.publications, 1);
	assert.deepEqual(fixture.main.reads, ['desktop-create', 'desktop-create']);
});

test('desktop rejects local-only delete and duplication and delegates non-project ownership', async (context) => {
	const fixture = await lifecycleFixture(context);
	await assert.rejects(fixture.store.deleteProject('project'), /V10.*delete.*unavailable/iu);
	await assert.rejects(fixture.store.duplicateProject('project'), /V10.*duplication.*unavailable/iu);
	assert.deepEqual(fixture.store.getStatus(), fixture.localStore.getStatus());
	assert.equal(await fixture.store.saveSetting('desktop-adapter', 'value'), 'value');
	assert.equal(await fixture.localStore.loadSetting('desktop-adapter', null), 'value');
	assert.equal(fixture.store.preservesProjectsOnClear(), true);
	assert.equal(fixture.store.prepareProjectHandoff, undefined);
	assert.deepEqual(await fixture.store.listProjects(), []);
});

test('desktop V10 main JSON and the exact V18 shadow preserve a nonempty subsequence graph', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'nested-main-shadow', revision: 0, nested: true });
	fixture.main.seed(current);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), current);
	assert.deepEqual((await fixture.localStore.loadProject(String(current.id)) as FramescaperProjectV18).subsequences,
		current.subsequences);

	const next = { ...structuredClone(current), revision: 1, title: 'Nested main and shadow' };
	assert.deepEqual(await fixture.store.saveProject(next), next);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), next);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), next);
	assert.deepEqual((fixture.main.lastBegin?.project as FramescaperProjectV18).subsequences,
		current.subsequences);
});

test('desktop V10 main JSON and the exact V18 shadow preserve a nonempty multicamera graph', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'multicamera-main-shadow', revision: 0, multicamera: true });
	fixture.main.seed(current);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), current);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), current);

	const next = structuredClone(current) as unknown as MutableFramescaperProject;
	next.revision = 1;
	next.title = 'Multicamera main and shadow';
	next.multicameraGroups[0]!.activeMemberId = 'desktop-camera-b';
	assert.deepEqual(await fixture.store.saveProject(next), next);
	assert.deepEqual(await fixture.store.loadProject(String(current.id)), next);
	assert.deepEqual(await fixture.localStore.loadProject(String(current.id)), next);
	assert.deepEqual(
		(fixture.main.lastBegin?.project as FramescaperProjectV18).multicameraGroups,
		next.multicameraGroups,
	);
});

type LocalStore = ReturnType<typeof createFramescaperProjectStoreV18>;

interface BaseLifecycleFixture {
	readonly localStore: LocalStore;
	readonly main: MainFixture;
}

interface LifecycleFixture extends BaseLifecycleFixture {
	readonly store: FramescaperDesktopProjectStoreV10Adapter<LocalStore>;
	readonly main: MainFixture;
}

interface WebLifecycleFixture extends BaseLifecycleFixture {
	readonly store: LocalStore;
	readonly main: MainFixture;
}

function lifecycleFixture(context: TestContext): Promise<LifecycleFixture>;
function lifecycleFixture(context: TestContext, desktop: false): Promise<WebLifecycleFixture>;
async function lifecycleFixture(
	context: TestContext,
	desktop = true,
): Promise<LifecycleFixture | WebLifecycleFixture> {
	const localStore = createFramescaperProjectStoreV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
	});
	await localStore.ready();
	context.after(() => localStore.close());
	const authority = framescaperProjectStoreAuthorityV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, localStore);
	assert.ok(authority.opfs);
	const archive = new FramescaperScapeArchiveV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		store: localStore as unknown as FramescaperDesktopProjectLibraryV10ShadowStore,
		port: authority.port,
		opfs: authority.opfs,
	});
	const main = new MainFixture();
	if (!desktop) return { localStore, store: localStore, main };
	installBridge(context, main.api);
	const renderer = await connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: localStore as unknown as FramescaperDesktopProjectLibraryV10ShadowStore, archive },
	);
	assert.ok(renderer);
	const store = createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore, desktopProjectLibrary: renderer },
	);
	return { localStore, store, main };
}

class MainFixture {
	readonly events: string[] = [];
	readonly reads: string[] = [];
	readonly api;
	beforeFinish: (() => Promise<void>) | null = null;
	lastBegin: Record<string, unknown> | null = null;
	#metadataRevision = 0;
	#projects = new Map<string, FramescaperProjectV18>();
	#active: FramescaperProjectV18 | null = null;
	#connected = false;
	#publications = 0;

	constructor() {
		this.api = Object.freeze({
			connect: async () => { this.#connected = true; return createFramescaperDesktopProjectLibraryV10Handshake(); },
			handshakeState: () => this.#connected ? 'admitted' : 'pending',
			readProjectBundle: async (projectId: string) => {
				this.reads.push(projectId);
				const project = this.#projects.get(projectId);
				return project ? bundle(project, this.#metadataRevision) : null;
			},
			readBodyChunk: async () => { throw new Error('Format-1 fixture has no desktop bodies.'); },
			beginPublication: async (request: Record<string, unknown>) => this.#begin(request),
			writePublicationChunk: async () => { throw new Error('Format-1 fixture has no upload bodies.'); },
			finishPublication: async (request: Record<string, unknown>) => this.#finish(request),
			abortPublication: async () => { this.#active = null; return true; },
		});
	}

	get publications(): number { return this.#publications; }

	seed(project: FramescaperProjectV18): void {
		const prior = this.#projects.get(String(project.id));
		if (!prior || JSON.stringify(prior) !== JSON.stringify(project)) this.#metadataRevision += 1;
		this.#projects.set(String(project.id), structuredClone(project));
	}

	#begin(request: Record<string, unknown>) {
		this.events.push('begin');
		this.lastBegin = structuredClone(request);
		const project = structuredClone(request.project) as FramescaperProjectV18;
		const current = this.#projects.get(String(project.id));
		if (request.expectedMetadataRevision !== this.#metadataRevision) throw new Error('metadata CAS stale');
		const expected = request.expectedProject as { projectRevision: number; projectSha256: string } | null;
		if (expected === null) {
			if (current) throw new Error('project already exists');
		} else {
			if (!current || Number(current.revision) !== expected.projectRevision
				|| digest(new TextEncoder().encode(JSON.stringify(current))) !== expected.projectSha256) {
				throw new Error('project CAS stale');
			}
		}
		assert.deepEqual(request.bodies, []);
		this.#active = project;
		return { publicationId: PUBLICATION_ID, maximumChunkBytes: 4 * 1024 * 1024, bodyCount: 0 };
	}

	async #finish(request: Record<string, unknown>) {
		this.events.push('finish');
		assert.equal(request.publicationId, PUBLICATION_ID);
		assert.ok(this.#active);
		await this.beforeFinish?.();
		const project = this.#active;
		this.#active = null;
		this.#projects.set(String(project.id), structuredClone(project));
		this.#metadataRevision += 1;
		this.#publications += 1;
		return bundle(project, this.#metadataRevision);
	}
}

function bundle(project: FramescaperProjectV18, metadataRevision: number) {
	const document = JSON.stringify(project);
	const bytes = new TextEncoder().encode(document);
	const sha = digest(bytes);
	const id = 'desktop_entry_01';
	return {
		metadataRevision,
		project: {
			id, projectId: String(project.id), name: String(project.title),
			metadataFile: `${id}/${String(project.revision)}-${sha}.json`,
			preferredProduct: 'framescaper', updatedAtMs: 1_786_550_400_000,
			projectSchemaVersion: 18, projectRevision: Number(project.revision),
			byteLength: bytes.byteLength, sha256: sha,
		},
		document,
		bodies: [],
	};
}

function installBridge(context: TestContext, api: unknown): void {
	const name = 'framescaperProjectLibraryDesktop';
	const prior = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		configurable: true, enumerable: true, writable: false,
		value: Object.freeze({ v10: api }),
	});
	context.after(() => {
		if (prior) Object.defineProperty(globalThis, name, prior);
		else Reflect.deleteProperty(globalThis, name);
	});
}

function projectFixture(options: Readonly<{
	id: string;
	revision: number;
	title?: string;
	nested?: boolean;
	multicamera?: boolean;
}>): FramescaperProjectV18 {
	const multicamera = options.multicamera === true;
	const rate = { num: 30, den: 1 };
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: options.id, title: options.title ?? options.id, now: '2026-08-13T12:00:00.000Z',
		...(multicamera ? {
			sources: [
				createVideoSourceV10({
					id: 'desktop-camera-source-a', name: 'Camera A', storageKey: 'camera-a',
					mimeType: 'video/mp4', contentSha256: '12'.repeat(32), sampleFrameCount: 480_000,
					sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
				}),
				createVideoSourceV10({
					id: 'desktop-camera-source-b', name: 'Camera B', storageKey: 'camera-b',
					mimeType: 'video/mp4', contentSha256: '34'.repeat(32), sampleFrameCount: 480_000,
					sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
				}),
			],
			clips: [{
				kind: 'video', id: 'desktop-multicamera-output', sourceId: 'desktop-camera-source-a',
				title: 'Multicamera output', sequenceId: 'main-sequence', sequenceStartFrame: 0,
				sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
			}],
			tracks: [createVideoTrackV10({
				id: 'desktop-video-track', name: 'Video',
				clipIds: ['desktop-multicamera-output'], locked: false,
			})],
			sequences: [{ id: 'main-sequence', rate, trackIds: ['desktop-video-track'] }],
			primarySequenceId: 'main-sequence',
			multicameraGroups: [{
				id: 'desktop-multicamera-group', projectId: options.id,
				sequenceId: 'main-sequence', outputClipId: 'desktop-multicamera-output',
				activeMemberId: 'desktop-camera-a',
				members: [{
					id: 'desktop-camera-a', groupId: 'desktop-multicamera-group',
					sourceId: 'desktop-camera-source-a', syncOffsetSamples: 0,
				}, {
					id: 'desktop-camera-b', groupId: 'desktop-multicamera-group',
					sourceId: 'desktop-camera-source-b', syncOffsetSamples: 0,
				}],
			}],
		} : {}),
		...(options.nested ? {
			sequences: [
				{ id: 'main-sequence', rate, trackIds: [] },
				{ id: 'nested-source-sequence', rate, trackIds: [] },
			],
			primarySequenceId: 'main-sequence',
			subsequences: [{
				id: 'desktop-nested-placement',
				sequenceId: 'main-sequence',
				sourceSequenceId: 'nested-source-sequence',
				sequenceStartFrame: 0,
				sequenceFrameCount: 30,
				sourceInFrame: 0,
				sourceFrameCount: 30,
			}],
		} : {}),
	});
	return { ...project, revision: options.revision };
}

interface MutableFramescaperProject extends Record<string, unknown> {
	revision: number;
	title: string;
	multicameraGroups: Array<{
		activeMemberId: string;
	}>;
}

function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
