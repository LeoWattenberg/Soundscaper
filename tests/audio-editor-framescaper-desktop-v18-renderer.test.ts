/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	connectFramescaperDesktopProjectLibraryV18Renderer,
} from '../src/framescaper/desktop-project-library-v18-renderer.ts';
import {
	createFramescaperDesktopProjectStoreV18Adapter,
} from '../src/framescaper/desktop-project-library-v18-store-adapter.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectStoreV27 } from '../src/framescaper/editor-project-store-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import {
	createFramescaperV27DurableBodyFixture,
	seedFramescaperV27DurableBodies,
} from './helpers/framescaper-v27-durable-body-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('V18 renderer admits only its exact frozen V27 handshake and round-trips V27', async (context) => {
	const project = createFramescaperProjectV27(PROFILE, {
		id: 'framescaper-v18-renderer-project', title: 'V18 renderer', revision: 0,
		now: '2026-08-23T12:00:00.000Z',
	});
	const harness = installBridge(context);
	const store = await productStore(context);
	const renderer = await connectFramescaperDesktopProjectLibraryV18Renderer(PROFILE, store);
	assert.ok(renderer);
	assert.deepEqual(await renderer.publishProject({ project }), project);
	assert.deepEqual(await renderer.readProject(String(project.id)), project);
	assert.deepEqual(await renderer.listProjects(), [{
		id: project.id, title: project.title, revision: 0, updatedAt: project.updatedAt,
	}]);
	assert.deepEqual(harness.calls.slice(0, 2), ['connect', 'listProjects']);
	await assert.rejects(
		connectFramescaperDesktopProjectLibraryV18Renderer(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, store),
		/authenticated selected Framescaper V27 runtime profile/iu,
	);
});

test('V18 adapter is bound to the admitted V27 store/renderer composition', async (context) => {
	installBridge(context);
	const store = await productStore(context);
	const renderer = await connectFramescaperDesktopProjectLibraryV18Renderer(PROFILE, store);
	assert.ok(renderer);
	const adapter = createFramescaperDesktopProjectStoreV18Adapter(PROFILE, {
		localStore: store, desktopProjectLibrary: renderer,
	});
	const project = createFramescaperProjectV27(PROFILE, {
		id: 'framescaper-v18-adapter-project', title: 'V18 adapter', revision: 0,
		now: '2026-08-23T12:01:00.000Z',
	});
	assert.deepEqual(await adapter.createProjectIfAbsent(project), project);
	assert.equal((adapter as unknown as { preservesProjectsOnClear(): boolean }).preservesProjectsOnClear(), true);

	const foreignStore = await productStore(context);
	assert.throws(() => createFramescaperDesktopProjectStoreV18Adapter(PROFILE, {
		localStore: foreignStore, desktopProjectLibrary: renderer,
	}), /exact admitted Framescaper desktop V18 renderer composition/iu);
});

test('V18 renderer transfers V27 managed bodies through the inherited bounded protocol', async (context) => {
	const body = Uint8Array.of(2, 4, 6, 8, 10, 12);
	const bodySha256 = digest(body);
	const project = createFramescaperProjectV27(PROFILE, {
		id: 'framescaper-v18-managed-body', title: 'V18 body', revision: 0,
		now: '2026-08-23T12:02:00.000Z',
		sources: [createVideoSource({
			id: 'video-source', name: 'Original.mov', storageKey: 'v18-managed-original',
			mimeType: 'video/quicktime', contentSha256: bodySha256,
			sampleFrameCount: 4_000, sampleRate: 48_000, sourceFrameCount: 2,
			frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
		})],
	});
	const harness = installBridge(context);
	const store = await productStore(context);
	await store.writeMediaAsset('v18-managed-original', blob(body, 'video/quicktime'), {
		kind: 'video-original', encoding: 'framescaper-video-original-v1',
		mimeType: 'video/quicktime', name: 'Original.mov',
	});
	const renderer = await connectFramescaperDesktopProjectLibraryV18Renderer(PROFILE, store);
	assert.ok(renderer);
	await renderer.publishProject({ project });
	assert.deepEqual(harness.publishedBodies.map(({ kind }) => kind), ['video-original']);
	await store.deleteMediaAsset('v18-managed-original');
	assert.deepEqual(await renderer.readProject(String(project.id)), project);
	const restored = await store.loadMediaAsset('v18-managed-original');
	assert.ok(restored);
	assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), body);
});

test('selected V18 renderer carries every V27 finishing body through packaged handoff', async (context) => {
	const fixture = await createFramescaperV27DurableBodyFixture();
	const harness = installBridge(context);
	const store = await productStore(context);
	await seedFramescaperV27DurableBodies(store, fixture);
	const renderer = await connectFramescaperDesktopProjectLibraryV18Renderer(PROFILE, store);
	assert.ok(renderer);
	await renderer.publishProject({ project: fixture.project });
	assert.deepEqual(harness.publishedBodies.map(({ kind }) => kind), [
		'video-original', 'video-proxy', 'video-timing',
		'framescaper-still', 'framescaper-freeze-render',
		'framescaper-cube-lut', 'framescaper-motion-analysis',
	]);
	for (const storageKey of fixture.bodies.keys()) await store.deleteMediaAsset(storageKey);
	assert.deepEqual(await renderer.readProject(String(fixture.project.id)), fixture.project);
	for (const [storageKey, expected] of fixture.bodies) {
		const restored = await store.loadMediaAsset(storageKey);
		assert.ok(restored, storageKey);
		assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), expected.bytes, storageKey);
	}
});

test('V18 renderer rejects a V17 identity before any project operation', async (context) => {
	installBridge(context, {
		projectSchemaVersion: 20,
		storageDatabaseName: 'kw-media-framescaper-editor-v20',
		desktopLibrarySchemaVersion: 17,
		desktopDatabaseUserVersion: 19,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v17'],
	});
	const store = await productStore(context);
	await assert.rejects(
		connectFramescaperDesktopProjectLibraryV18Renderer(PROFILE, store),
		/Framescaper desktop V18 handshake identity is unsupported/iu,
	);
});

async function productStore(context: TestContext) {
	const store = createFramescaperProjectStoreV27(PROFILE, {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
	});
	await store.ready();
	context.after(async () => { await store.close(); });
	return store;
}

interface BridgeHarness {
	readonly calls: string[];
	readonly publishedBodies: Record<string, unknown>[];
}

function installBridge(
	context: TestContext,
	handshakeOverrides: Readonly<Record<string, unknown>> = {},
): BridgeHarness {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'framescaperDesktop', previous);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
	const harness: BridgeHarness = { calls: [], publishedBodies: [] };
	let metadataRevision = 0;
	let bundle: Record<string, unknown> | null = null;
	let pending: Record<string, unknown> | null = null;
	let pendingBytes: Uint8Array[][] = [];
	const committedBytes = new Map<string, Uint8Array>();
	const api = Object.freeze({
		abortPublication: async () => { pending = null; pendingBytes = []; return true; },
		beginPublication: async (request: Record<string, unknown>) => {
			pending = structuredClone(request);
			const bodies = request.bodies as Record<string, unknown>[];
			pendingBytes = bodies.map(() => []);
			return {
				publicationId: request.publicationId,
				maximumChunkBytes: 4 * 1024 * 1024,
				bodyCount: bodies.length,
			};
		},
		connect: async () => { harness.calls.push('connect'); return exactHandshake(handshakeOverrides); },
		deleteProject: async (request: Record<string, unknown>) => ({
			projectId: request.projectId, metadataRevision: ++metadataRevision, deleted: true,
		}),
		duplicateProject: async () => { throw new Error('not used'); },
		finishPublication: async () => {
			if (!pending) throw new Error('missing publication');
			const project = pending.project as Record<string, unknown>;
			const bodies = pending.bodies as Record<string, unknown>[];
			for (const [index, descriptor] of bodies.entries()) {
				committedBytes.set(bodyKey(descriptor), concatenate(pendingBytes[index]!));
			}
			harness.publishedBodies.splice(0, harness.publishedBodies.length, ...structuredClone(bodies));
			const document = JSON.stringify(project);
			const bytes = new TextEncoder().encode(document);
			metadataRevision += 1;
			bundle = {
				metadataRevision,
				project: {
					id: 'opaque-entry', projectId: project.id, name: project.title,
					metadataFile: 'opaque-entry/project.json', preferredProduct: 'framescaper',
					updatedAtMs: Date.parse(String(project.updatedAt)), projectSchemaVersion: 27,
					projectRevision: project.revision, byteLength: bytes.byteLength, sha256: digest(bytes),
				},
				document, bodies: structuredClone(bodies),
			};
			pending = null;
			pendingBytes = [];
			return structuredClone(bundle);
		},
		handshakeState: () => 'admitted',
		listProjects: async () => {
			harness.calls.push('listProjects');
			const row = bundle?.project as Record<string, unknown> | undefined;
			return {
				metadataRevision,
				projects: row ? [{
					id: row.projectId, title: row.name, revision: row.projectRevision,
					updatedAt: new Date(Number(row.updatedAtMs)).toISOString(),
				}] : [],
			};
		},
		readBodyChunk: async (request: Record<string, unknown>) => {
			const bytes = committedBytes.get(bodyKey(request.body as Record<string, unknown>));
			if (!bytes) throw new Error('missing body');
			const offset = Number(request.offset);
			return bytes.slice(offset, offset + Number(request.length));
		},
		readProjectBundle: async () => structuredClone(bundle),
		writePublicationChunk: async (request: Record<string, unknown>) => {
			const bodyIndex = Number(request.bodyIndex);
			const bytes = (request.bytes as Uint8Array).slice();
			pendingBytes[bodyIndex]!.push(bytes);
			const nextOffset = Number(request.offset) + bytes.byteLength;
			const descriptor = (pending!.bodies as Record<string, unknown>[])[bodyIndex]!;
			return { bodyIndex, nextOffset, complete: nextOffset === descriptor.byteLength };
		},
	});
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true, enumerable: true, writable: false,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary: api }) }),
	});
	return harness;
}

function exactHandshake(overrides: Readonly<Record<string, unknown>>) {
	return {
		kind: 'framescaper-project-library-handshake', version: 1, owner: 'framescaper',
		projectSchemaVersion: 27, scapeFormatVersions: [1, 2], attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v27', desktopLibrarySchemaVersion: 18,
		desktopDatabaseUserVersion: 20, desktopLibraryScope: ['kw.media', 'scape-project-library', 'v18'],
		...overrides,
	};
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function bodyKey(body: Record<string, unknown>): string {
	return JSON.stringify([body.kind, body.storageKey]);
}

function blob(bytes: Uint8Array, type: string): Blob {
	return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}
