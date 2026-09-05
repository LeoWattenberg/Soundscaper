/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import {
	FramescaperDesktopProjectLibraryCommittedError,
	FramescaperDesktopProjectLibraryIndeterminateError,
} from '../src/framescaper/desktop-project-library-errors.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE } from
	'../src/framescaper/desktop-project-library-renderer-contract.ts';
import {
	assertFramescaperDesktopProjectLibraryRendererComposition,
	connectFramescaperDesktopProjectLibraryRenderer,
	type FramescaperDesktopProjectLibraryRenderer,
} from '../src/framescaper/desktop-project-library-renderer.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Store = ReturnType<typeof createFramescaperProjectStore>;
type Method = (...args: readonly unknown[]) => unknown;
type Data = Record<string, unknown>;

interface Library {
	metadataRevision: number;
	readonly documents: Map<string, string>;
	readonly admitted: Map<string, Data>;
	readonly calls: string[];
}

const API_FIELDS = [
	'connect', 'handshakeState', 'listProjects', 'readProjectBundle', 'readBodyChunk',
	'beginPublication', 'writePublicationChunk', 'finishPublication', 'abortPublication',
	'deleteProject', 'duplicateProject',
] as const;
const RESTORED = new WeakSet<object>();
const OPTIONS = Object.freeze({ now: '2026-09-01T11:00:00.000Z' });

test('connecting yields no renderer when the desktop global or its project library is absent', async (context) => {
	const store = await durableStore(context);

	assert.equal(await connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store), null);
	installGlobal(context, { configurable: true, enumerable: true, value: Object.freeze({ v1: Object.freeze({}) }) });
	assert.equal(await connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store), null);
});

test('connecting refuses a desktop global that is not a frozen tree of own data properties', async (context) => {
	const store = await durableStore(context);
	const api = createBridge(createLibrary());
	const connect = () => connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store);
	const own = /global must be an own data property/u;
	const refusals: readonly (readonly [PropertyDescriptor, RegExp])[] = [
		[{ configurable: true, value: frozenTree(api) }, own],
		[{ configurable: true, enumerable: true, get: () => frozenTree(api) }, own],
		[data({ v1: Object.freeze({ projectLibrary: api }) }), /desktop bridge must be frozen/u],
		[data(Object.freeze({ v1: { projectLibrary: api } })), /v1 bridge must be frozen/u],
		[data(frozenTree({ ...api })), /project-library bridge must be frozen/u],
		[data(frozenTree(Object.freeze({ ...api, duplicateProject: 'no' }))), /bridge requires duplicateProject/u],
		[data(frozenTree(Object.freeze({ ...api, extra: () => undefined }))),
			/project-library bridge has unsupported fields/u],
	];

	for (const [descriptor, message] of refusals) {
		installGlobal(context, descriptor);
		await assert.rejects(connect, message);
	}
});

test('connecting refuses a handshake identity or state the desktop bridge does not retain', async (context) => {
	const store = await durableStore(context);
	const handshake = { ...FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE } as Data;
	const connect = () => connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store);
	const identity = /handshake identity is unsupported/u;
	const refusals: readonly (readonly [Data, RegExp])[] = [
		[{ connect: async () => ({ ...handshake, version: 2 }) }, identity],
		[{ connect: async () => ({ ...handshake, storageDatabaseName: 'kw-media-soundscaper-editor-v1' }) }, identity],
		[{ connect: async () => ({ ...handshake, desktopLibraryScope: ['kw.media', 'framescaper'] }) }, identity],
		[{ connect: async () => ({ ...handshake, scapeFormatVersions: [1, 2] }) }, identity],
		[{ connect: async () => ({ ...handshake, extra: 1 }) }, /handshake has unsupported fields/u],
		[{ handshakeState: () => 'pending' }, /did not retain its admitted handshake/u],
	];

	for (const [overrides, message] of refusals) {
		installBridge(context, createBridge(createLibrary(), overrides as Readonly<Record<string, Method>>));
		await assert.rejects(connect, message);
	}
});

test('connecting requires the exact durable Framescaper v1 shadow store', async (context) => {
	installBridge(context, createBridge(createLibrary()));
	const options = { indexedDB: null, preferOpfs: false, storageManager: persistentStorage() };
	const ephemeral = createFramescaperProjectStore(PROFILE, options);
	await ephemeral.ready();
	context.after(() => ephemeral.close());

	const connect = (store: unknown) => () => connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store);
	await assert.rejects(connect(null), /exact Framescaper shadow store is required/u);
	await assert.rejects(connect({}), /exact Framescaper baseline store authority is required/u);
	await assert.rejects(connect(ephemeral), /requires a durable shadow/u);
});

test('the composition assertion admits only the exact profile, store and renderer triple', async (context) => {
	const store = await durableStore(context);
	const other = await durableStore(context);
	installBridge(context, createBridge(createLibrary()));
	const renderer = await connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store);
	assert.ok(renderer);
	const composition = /exact admitted Framescaper desktop renderer composition/u;

	assert.doesNotThrow(() => assertFramescaperDesktopProjectLibraryRendererComposition(PROFILE, store, renderer));
	assert.throws(() => assertFramescaperDesktopProjectLibraryRendererComposition(PROFILE, other, renderer),
		composition);
	assert.throws(() => assertFramescaperDesktopProjectLibraryRendererComposition(PROFILE, store, {}), composition);
	assert.throws(() => assertFramescaperDesktopProjectLibraryRendererComposition({}, store, renderer), TypeError);
});

test('listing projects refuses a catalog whose envelope or summaries changed', async (context) => {
	const library = createLibrary();
	let value: unknown = { metadataRevision: 0, projects: [] };
	const renderer = await connect(context, library, { listProjects: async () => value });
	const listing = () => renderer.listProjects();

	assert.deepEqual(await renderer.listProjects(), []);
	value = { metadataRevision: 0, projects: {} };
	await assert.rejects(listing, /desktop catalog is invalid/u);
	value = { metadataRevision: -1, projects: [] };
	await assert.rejects(listing, RangeError);
	value = { metadataRevision: 0 };
	await assert.rejects(listing, /catalog has unsupported fields/u);
	value = { metadataRevision: 0, projects: [summary({ revision: 1.5 })] };
	await assert.rejects(listing, RangeError);
	value = { metadataRevision: 0, projects: [summary({ updatedAt: 'not a date' })] };
	await assert.rejects(listing, /project timestamp is invalid/u);
	value = { metadataRevision: 0, projects: [{ ...summary({}), extra: 1 }] };
	await assert.rejects(listing, /summary has unsupported fields/u);
	value = { metadataRevision: 0, projects: new Array<Data>(10_001).fill(summary({})) };
	await assert.rejects(listing, /desktop catalog is invalid/u);
	value = { metadataRevision: 4, projects: [summary({})] };
	assert.deepEqual(await renderer.listProjects(), [summary({})]);
});

test('reading a project returns null when absent and refuses a bundle that disagrees with its row',
	async (context) => {
		const library = createLibrary();
		const project = seed(library, 'read-project');
		let mutate: (bundle: Data) => unknown = (bundle) => bundle;
		const renderer = await connect(context, library, {
			readProjectBundle: async (projectId) => {
				const bundle = bundleFor(library, String(projectId));
				return bundle === null ? null : mutate(bundle);
			},
		});
		const reading = () => renderer.readProject(String(project.id));

		assert.equal(await renderer.readProject('absent-project'), null);
		assert.deepEqual(await reading(), project);
		mutate = (bundle) => ({ ...bundle, document: `${String(bundle.document)} ` });
		await assert.rejects(reading, /changed bytes or digest/u);
		mutate = (bundle) => withRow(bundle, { preferredProduct: 'soundscaper' });
		await assert.rejects(reading, /project row is invalid/u);
		mutate = (bundle) => withRow(bundle, { name: 'Renamed behind the renderer' });
		await assert.rejects(reading, /disagrees with its descriptor/u);
		mutate = (bundle) => withRow(bundle, { byteLength: 0 });
		await assert.rejects(reading, RangeError);
		mutate = (bundle) => ({ ...bundle, document: 17 });
		await assert.rejects(reading, /desktop document is invalid/u);
		mutate = (bundle) => ({ ...bundle, extra: 1 });
		await assert.rejects(reading, /desktop bundle has unsupported fields/u);
		assert.throws(() => renderer.readProject(''), /bounded printable Framescaper desktop project id/u);
	});

test('reading a project honours an abort signal before and after the bridge read', async (context) => {
	const library = createLibrary();
	const project = seed(library, 'abort-project');
	const controller = new AbortController();
	const reason = new Error('the reader cancelled');
	const renderer = await connect(context, library, {
		readProjectBundle: async (projectId) => {
			controller.abort(reason);
			return bundleFor(library, String(projectId));
		},
	});

	await assert.rejects(() => renderer.readProject(String(project.id), { signal: controller.signal }),
		(error: unknown) => error === reason);
	assert.deepEqual(library.calls, ['readProjectBundle']);
	const closed = new AbortController();
	closed.abort();
	await assert.rejects(() => renderer.readProject(String(project.id), { signal: closed.signal }),
		(error: unknown) => (error as Error).name === 'AbortError');
	assert.deepEqual(library.calls, ['readProjectBundle'], 'the aborted read never reached the bridge');
});

test('Scape creation refuses a non-zero revision and yields null once the project exists', async (context) => {
	const library = createLibrary();
	const renderer = await connect(context, library);
	const project = createFramescaperProject(PROFILE, {
		id: 'scape-project', title: 'Imported Scape', now: '2026-09-01T10:00:00.000Z',
	});

	assert.throws(() => renderer.createScapeProjectIfAbsent(advance(project, 1, 'Advanced')),
		/Scape creation requires revision zero/u);
	assert.deepEqual(await renderer.createScapeProjectIfAbsent(project), project);
	assert.equal(await renderer.createScapeProjectIfAbsent(project), null);
	assert.deepEqual(committed(library, 'scape-project'), project);
});

test('conditional publication refuses a foreign identity, a stale expectation and an unmoved revision',
	async (context) => {
		const library = createLibrary();
		let metadataRevision: number | null = null;
		const renderer = await connect(context, library, {
			listProjects: async () => ({
				...catalogOf(library),
				...(metadataRevision === null ? {} : { metadataRevision }),
			}),
		});
		const base = createFramescaperProject(PROFILE, {
			id: 'conditional-project', title: 'Base', now: '2026-09-01T11:00:00.000Z',
		});
		const foreign = createFramescaperProject(PROFILE, { ...OPTIONS, id: 'other-project', title: 'Other' });
		const first = advance(base, 1, 'First');

		await assert.rejects(() => renderer.publishProjectIfCurrent(foreign, base),
			/conditional publication requires one project identity/u);
		assert.equal(await renderer.publishProjectIfCurrent(base, first), null, 'no authority row exists yet');
		assert.deepEqual(await renderer.createScapeProjectIfAbsent(base), base);
		assert.equal(await renderer.publishProjectIfCurrent(advance(base, 0, 'Divergent'), first), null,
			'the expectation no longer matches the authority');
		await assert.rejects(() => renderer.publishProjectIfCurrent(base, advance(base, 0, 'Same revision')),
			/requires a strictly higher revision/u);
		metadataRevision = 9_999;
		await assert.rejects(() => renderer.publishProjectIfCurrent(base, first),
			/catalog changed before publication/u);
		metadataRevision = null;
		assert.deepEqual(await renderer.publishProjectIfCurrent(base, first), first);
		assert.deepEqual(committed(library, 'conditional-project'), first);
	});

test('a failing publication aborts its admission and classifies committed and indeterminate outcomes',
	async (context) => {
		const library = createLibrary();
		const admissionRefused = new Error('admission refused');
		const channelClosed = new Error('the publication channel closed');
		const withdrawn = new Error('the caller withdrew before finish');
		let beginFails = false;
		let finishFails = false;
		let readback: Data | null = null;
		const renderer = await connect(context, library, {
			beginPublication: async (request) => {
				if (beginFails) throw admissionRefused;
				return admissionFor(library, request as Data);
			},
			finishPublication: async (request) => {
				if (finishFails) throw channelClosed;
				commit(library, request as Data);
				return readback ?? bundleFor(library, 'publication-project');
			},
		});
		const project = createFramescaperProject(PROFILE, {
			id: 'publication-project', title: 'Publication', now: '2026-09-01T12:00:00.000Z',
		});
		beginFails = true;
		await assert.rejects(() => renderer.publishProject({ project }), admissionRefused);
		assert.equal(library.calls.includes('abortPublication'), false, 'nothing was admitted to abort');
		beginFails = false;
		await assert.rejects(
			() => renderer.publishProject({ project, beforeFinish: () => { throw withdrawn; } }), withdrawn);
		assert.equal(library.calls.at(-1), 'abortPublication');
		finishFails = true;
		await assert.rejects(() => renderer.publishProject({ project }),
			(error: unknown) => error instanceof FramescaperDesktopProjectLibraryIndeterminateError
				&& error.operation === 'publication' && error.projectId === 'publication-project'
				&& error.cause === channelClosed);
		assert.equal(library.calls.at(-1), 'abortPublication', 'an indeterminate finish still asks main to abort');
		finishFails = false;
		readback = documentBundle(1, advance(project, 0, 'Renamed by main'));
		await assert.rejects(() => renderer.publishProject({ project }),
			(error: unknown) => error instanceof FramescaperDesktopProjectLibraryCommittedError
				&& error.operation === 'publication' && error.projectId === 'publication-project');
		assert.notEqual(library.calls.at(-1), 'abortPublication', 'a finished publication is never aborted');
	});

test('an aborted publication signal stops the renderer before it asks main to finish', async (context) => {
	const library = createLibrary();
	const renderer = await connect(context, library);
	const controller = new AbortController();
	const project = createFramescaperProject(PROFILE, {
		id: 'aborted-publication', title: 'Aborted', now: '2026-09-01T12:30:00.000Z',
	});

	await assert.rejects(
		() => renderer.publishProject({ project, signal: controller.signal, beforeFinish: () => controller.abort() }),
		(error: unknown) => (error as Error).name === 'AbortError');
	assert.equal(library.calls.includes('finishPublication'), false);
	assert.equal(library.calls.at(-1), 'abortPublication');
	assert.equal(library.documents.has('aborted-publication'), false);
});

test('deleting reports whether the current project matched and refuses an unacknowledged result',
	async (context) => {
		const library = createLibrary();
		const project = seed(library, 'delete-project');
		let acknowledgement: Data | null = null;
		const renderer = await connect(context, library, {
			deleteProject: async (request) => acknowledgement ?? deleteFrom(library, request as Data),
		});
		const deleting = () => renderer.deleteProject('delete-project');

		await renderer.deleteProject('absent-project');
		assert.deepEqual(library.calls, ['readProjectBundle'], 'an absent project never reaches main');
		assert.equal(await renderer.deleteProjectIfCurrent(createFramescaperProject(PROFILE, {
			id: 'absent-project', title: 'Absent', now: '2026-09-01T13:00:00.000Z',
		})), false);
		assert.equal(await renderer.deleteProjectIfCurrent(advance(project, 0, 'Diverged')), false);
		acknowledgement = { projectId: 'delete-project', metadataRevision: 1, deleted: false };
		await assert.rejects(deleting, /delete acknowledgement changed/u);
		acknowledgement = { projectId: 'other-project', metadataRevision: 1, deleted: true };
		await assert.rejects(deleting, /delete acknowledgement changed/u);
		acknowledgement = { projectId: 'delete-project', deleted: true };
		await assert.rejects(deleting, /delete result has unsupported fields/u);
		acknowledgement = null;
		assert.equal(library.documents.has('delete-project'), true, 'no refused acknowledgement deleted the row');
		assert.equal(await renderer.deleteProjectIfCurrent(project), true);
		assert.equal(library.documents.has('delete-project'), false);
	});

test('duplicating requires an available source and a bounded copy identity', async (context) => {
	const library = createLibrary();
	const project = seed(library, 'duplicate-source');
	const renderer = await connect(context, library);
	const options = { id: 'duplicate-copy', title: 'Copy', timestamp: '2026-09-01T14:00:00.000Z' };
	const duplicating = (patch: Partial<typeof options>) => (
		() => renderer.duplicateProject(String(project.id), { ...options, ...patch })
	);

	await assert.rejects(() => renderer.duplicateProject('absent-source', options),
		/duplicate source is unavailable/u);
	await assert.rejects(duplicating({ title: '' }), /project title is invalid/u);
	await assert.rejects(duplicating({ timestamp: 'whenever' }), /project timestamp is invalid/u);
	await assert.rejects(duplicating({ id: 'a copy id with spaces' }),
		/bounded printable Framescaper desktop project id/u);
	const copy = await renderer.duplicateProject(String(project.id), options) as unknown as Data;
	assert.deepEqual([copy.id, copy.title, copy.revision], ['duplicate-copy', 'Copy', 0]);
	assert.deepEqual(committed(library, 'duplicate-copy'), copy);
});

test('operations run one at a time and a rejected operation leaves the queue usable', async (context) => {
	const library = createLibrary();
	const order: string[] = [];
	let release = (): void => undefined;
	const gate = new Promise<void>((resolve) => { release = () => { resolve(); }; });
	const renderer = await connect(context, library, {
		readProjectBundle: async (projectId) => {
			order.push(`read:${String(projectId)}`);
			await gate;
			throw new Error('the bridge read failed');
		},
		listProjects: async () => { order.push('list'); return catalogOf(library); },
	});

	const failing = renderer.readProject('gated-project');
	const following = renderer.listProjects();
	await new Promise((resolve) => { setTimeout(resolve, 0); });
	const started = [...order];
	release();

	await assert.rejects(failing, /the bridge read failed/u);
	assert.deepEqual(await following, []);
	assert.deepEqual(started, ['read:gated-project'], 'the queued listing waited for the failing read');
	assert.deepEqual(order, ['read:gated-project', 'list']);
});

async function connect(
	context: TestContext,
	library: Library,
	overrides: Readonly<Record<string, Method>> = {},
): Promise<FramescaperDesktopProjectLibraryRenderer> {
	const store = await durableStore(context);
	installBridge(context, createBridge(library, overrides));
	const renderer = await connectFramescaperDesktopProjectLibraryRenderer(PROFILE, store);
	assert.ok(renderer);
	library.calls.length = 0;
	return renderer;
}

async function durableStore(context: TestContext): Promise<Store> {
	const store = createFramescaperProjectStore(PROFILE, {
		indexedDB: createInstrumentedIndexedDB(), preferOpfs: false, storageManager: persistentStorage(),
	});
	await store.ready();
	context.after(() => store.close());
	return store;
}

function createLibrary(): Library {
	return { metadataRevision: 0, documents: new Map(), admitted: new Map(), calls: [] };
}

function createBridge(library: Library, overrides: Readonly<Record<string, Method>> = {}): Data {
	const base: Record<string, Method> = {
		connect: async () => ({ ...FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE }),
		handshakeState: () => 'admitted',
		listProjects: async () => catalogOf(library),
		readProjectBundle: async (projectId) => bundleFor(library, String(projectId)),
		readBodyChunk: async () => new Uint8Array(),
		beginPublication: async (request) => admissionFor(library, request as Data),
		writePublicationChunk: async () => undefined,
		finishPublication: async (request) => bundleFor(library, commit(library, request as Data)),
		abortPublication: async (request) => library.admitted.delete(String((request as Data).publicationId)),
		deleteProject: async (request) => deleteFrom(library, request as Data),
		duplicateProject: async (request) => {
			const { sourceProjectId, copyProjectId, title, timestamp } = request as Record<string, string>;
			const source = JSON.parse(library.documents.get(sourceProjectId)!) as Data;
			const copy = { ...source, id: copyProjectId, title, revision: 0, updatedAt: timestamp };
			library.documents.set(copyProjectId, JSON.stringify(copy));
			library.metadataRevision += 1;
			return bundleFor(library, copyProjectId);
		},
	};
	return Object.freeze(Object.fromEntries(API_FIELDS.map((field) => [field, (...args: readonly unknown[]) => {
		library.calls.push(field);
		return (overrides[field] ?? base[field]!)(...args);
	}])));
}

/** The fake main holds one admitted project per publication id, the way the real session does. */
function admissionFor(library: Library, request: Data): Data {
	const bodies = request.bodies as readonly unknown[];
	library.admitted.set(String(request.publicationId), request.project as Data);
	return {
		publicationId: request.publicationId,
		maximumChunkBytes: 4 * 1024 * 1024,
		bodyCount: bodies.length,
		requiredBodyIndexes: bodies.map((_body, index) => index),
	};
}

function commit(library: Library, request: Data): string {
	const pending = library.admitted.get(String(request.publicationId));
	assert.ok(pending, 'the publication was admitted before it finished');
	const projectId = String(pending.id);
	library.documents.set(projectId, JSON.stringify(pending));
	library.metadataRevision += 1;
	return projectId;
}

function deleteFrom(library: Library, request: Data): Data {
	const projectId = String(request.projectId);
	library.documents.delete(projectId);
	library.metadataRevision += 1;
	return { projectId, metadataRevision: library.metadataRevision, deleted: true };
}

function catalogOf(library: Library): Data {
	return {
		metadataRevision: library.metadataRevision,
		projects: [...library.documents.values()].map((document) => {
			const { id, title, revision, updatedAt } = JSON.parse(document) as Data;
			return { id, title, revision, updatedAt };
		}),
	};
}

function bundleFor(library: Library, projectId: string): Data | null {
	const document = library.documents.get(projectId);
	return document === undefined ? null : documentBundle(library.metadataRevision, JSON.parse(document) as Data);
}

function documentBundle(metadataRevision: number, project: object): Data {
	const document = JSON.stringify(project);
	const parsed = project as Data;
	const digest = createHash('sha256').update(document).digest('hex');
	return {
		metadataRevision,
		project: {
			id: `entry-${String(parsed.id)}`, projectId: String(parsed.id), name: parsed.title,
			metadataFile: `entry-${String(parsed.id)}/${String(parsed.revision)}-${digest}.json`,
			preferredProduct: 'framescaper', updatedAtMs: 1,
			schemaFamily: 'framescaper', schemaVersion: 1, projectRevision: parsed.revision,
			byteLength: Buffer.byteLength(document), sha256: digest,
		},
		document,
		bodies: [],
	};
}

function withRow(bundle: Data, patch: Data): Data {
	return { ...bundle, project: { ...(bundle.project as Data), ...patch } };
}

function seed(library: Library, projectId: string): FramescaperProject {
	const project = createFramescaperProject(PROFILE, {
		id: projectId, title: 'Seeded', now: '2026-09-01T09:00:00.000Z',
	});
	library.documents.set(projectId, JSON.stringify(project));
	library.metadataRevision += 1;
	return project;
}

function committed(library: Library, projectId: string): unknown {
	const document = library.documents.get(projectId);
	assert.ok(document);
	return JSON.parse(document) as unknown;
}

function summary(patch: Data): Data {
	return { id: 'catalog', title: 'Catalog project', revision: 2, updatedAt: '2026-09-01T08:00:00.000Z', ...patch };
}

function advance(project: FramescaperProject, revision: number, title: string): FramescaperProject {
	return Object.freeze({ ...project, revision, title });
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true, persist: async () => true,
	} as unknown as StorageManager;
}

function frozenTree(projectLibrary: unknown): object {
	return Object.freeze({ v1: Object.freeze({ projectLibrary }) });
}

function data(value: unknown): PropertyDescriptor {
	return { configurable: true, enumerable: true, value };
}

function installBridge(context: TestContext, projectLibrary: unknown): void {
	installGlobal(context, data(frozenTree(projectLibrary)));
}

function installGlobal(context: TestContext, descriptor: PropertyDescriptor): void {
	if (!RESTORED.has(context)) {
		RESTORED.add(context);
		const prior = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
		context.after(() => {
			if (prior) Object.defineProperty(globalThis, 'framescaperDesktop', prior);
			else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
		});
	}
	Object.defineProperty(globalThis, 'framescaperDesktop', descriptor);
}
