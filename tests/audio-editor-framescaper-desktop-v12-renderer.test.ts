/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import {
	connectFramescaperDesktopProjectLibraryV12Renderer,
} from '../src/framescaper/desktop-project-library-v12-renderer.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectStoreV20 } from '../src/framescaper/editor-project-store-v20.ts';
import {
	cloneFramescaperProjectV20,
	createFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROFILE = FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE;

test('V12 renderer authenticates the selected handshake and round-trips exact V20', async (context) => {
	const project = createFramescaperProjectV20(PROFILE, {
		id: 'framescaper-v12-renderer-project', title: 'V12 renderer', revision: 0,
		now: '2026-08-22T12:00:00.000Z',
	});
	const harness = installBridge(context);
	const store = await productStore(context);
	const renderer = await connectFramescaperDesktopProjectLibraryV12Renderer(PROFILE, store);
	assert.ok(renderer);
	assert.deepEqual(await renderer.publishProject({ project }), project);
	assert.deepEqual(await renderer.readProject(project.id), project);
	assert.deepEqual(await renderer.listProjects(), [{
		id: project.id, title: project.title, revision: 0, updatedAt: project.updatedAt,
	}]);
	assert.deepEqual(harness.calls.slice(0, 2), ['connect', 'listProjects']);
	assert.equal(Object.hasOwn(globalThis, 'framescaperProjectLibraryDesktop'), false);
});

test('V12 renderer publishes and reacquires exact managed original, proxy, and timing bodies', async (context) => {
	const fixture = bodyFixture();
	const harness = installBridge(context);
	const store = await productStore(context);
	for (const body of fixture.assets) {
		await store.writeMediaAsset(body.storageKey, blob(body.bytes, body.mimeType), {
			kind: body.kind, encoding: body.encoding, mimeType: body.mimeType, name: body.storageKey,
		});
	}
	const renderer = await connectFramescaperDesktopProjectLibraryV12Renderer(PROFILE, store);
	assert.ok(renderer);
	assert.deepEqual(await renderer.publishProject({ project: fixture.project }), fixture.project);
	assert.deepEqual(harness.publishedBodies.map(({ kind }) => kind), [
		'video-original', 'video-timing', 'video-proxy', 'video-timing',
	]);
	assert.equal(JSON.stringify(harness.publishedBodies).includes('path'), false);

	for (const asset of fixture.assets) await store.deleteMediaAsset(asset.storageKey);
	assert.deepEqual(await renderer.readProject(fixture.project.id), fixture.project);
	for (const asset of fixture.assets) {
		const loaded = await store.loadMediaAsset(asset.storageKey);
		assert.ok(loaded);
		assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), asset.bytes);
	}
	const duplicate = await renderer.duplicateProject(fixture.project.id, {
		id: 'framescaper-v12-managed-bodies-copy', title: 'Managed bodies copy',
		timestamp: '2026-08-22T12:01:00.000Z',
	});
	assert.equal(duplicate.id, 'framescaper-v12-managed-bodies-copy');
	assert.equal(duplicate.title, 'Managed bodies copy');
	assert.equal(duplicate.revision, 0);
});

test('V12 renderer rolls back every newly acquired body when a desktop body is tampered', async (context) => {
	const fixture = bodyFixture();
	const harness = installBridge(context);
	const sourceStore = await productStore(context);
	for (const body of fixture.assets) {
		await sourceStore.writeMediaAsset(body.storageKey, blob(body.bytes, body.mimeType), {
			kind: body.kind, encoding: body.encoding, mimeType: body.mimeType, name: body.storageKey,
		});
	}
	const sourceRenderer = await connectFramescaperDesktopProjectLibraryV12Renderer(PROFILE, sourceStore);
	assert.ok(sourceRenderer);
	await sourceRenderer.publishProject({ project: fixture.project });
	await sourceStore.close();

	const targetStore = await productStore(context);
	const targetRenderer = await connectFramescaperDesktopProjectLibraryV12Renderer(PROFILE, targetStore);
	assert.ok(targetRenderer);
	harness.tamperReadBody = 'video-proxy';
	await assert.rejects(targetRenderer.readProject(fixture.project.id), /digest|SHA-256|changed/iu);
	for (const asset of fixture.assets) {
		assert.equal(await targetStore.getMediaAssetMetadata(asset.storageKey), null);
	}
});

test('V12 renderer refuses public generation aliases and foreign V20 lookalike stores', async (context) => {
	const name = 'framescaperProjectLibraryDesktop';
	const previous = Object.getOwnPropertyDescriptor(globalThis, name);
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, name, previous);
		else Reflect.deleteProperty(globalThis, name);
	});
	Object.defineProperty(globalThis, name, {
		configurable: true, enumerable: true, value: Object.freeze({ v12: Object.freeze({}) }),
	});
	await assert.rejects(
		connectFramescaperDesktopProjectLibraryV12Renderer(PROFILE, {
			databaseName: 'kw-media-framescaper-editor-v20', persistent: true,
		}),
		/product-created.*V20 store|store authority/iu,
	);
	const store = await productStore(context);
	assert.equal(await connectFramescaperDesktopProjectLibraryV12Renderer(PROFILE, store), null);
});

interface TestAsset {
	readonly kind: 'video-original' | 'video-proxy' | 'video-timing';
	readonly encoding: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly bytes: Uint8Array;
}

function bodyFixture(): Readonly<{ project: ReturnType<typeof cloneFramescaperProjectV20>; assets: readonly TestAsset[] }> {
	const original = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7);
	const originalSha = digest(original);
	const originalTiming = createVideoTimingAssetPublication(originalSha, {
		timescale: 24, presentationTicks: [0n, 1n], finalFrameDurationTicks: 1n,
	});
	const proxy = Uint8Array.of(9, 8, 7, 6, 5, 4);
	const proxySha = digest(proxy);
	const proxyTiming = createVideoTimingAssetPublication(proxySha, {
		timescale: 48, presentationTicks: [0n, 2n], finalFrameDurationTicks: 2n,
	});
	const base = createFramescaperProjectV20(PROFILE, {
		id: 'framescaper-v12-managed-bodies', title: 'Managed bodies', revision: 0,
		now: '2026-08-22T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'source', name: 'Original.mov', storageKey: 'managed-video-original',
			mimeType: 'video/quicktime', contentSha256: originalSha,
			sampleFrameCount: 4_000, sampleRate: 48_000, sourceFrameCount: 2,
			frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
			timingAsset: originalTiming.reference,
			timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Clip',
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 2,
			sourceInFrame: 0, sourceFrameCount: 2, retimeMap: null,
		}],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'] })],
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
	const candidate = structuredClone(base) as unknown as Record<string, unknown>;
	const source = (candidate.sources as Record<string, unknown>[])[0]!;
	source.proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha}`, mimeType: 'video/quicktime',
		byteLength: proxy.byteLength, sha256: proxySha, originalSha256: originalSha,
		originalAuthorityKind: 'owned', generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'editor-proxy', recipeVersion: 1, timingBackendId: 'ffprobe',
		timingRule: 'exact-presentation-boundaries-v1', frameCount: 2, boundaryCount: 3,
		timingAsset: proxyTiming.reference, audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	const manifest = candidate.featureRequirements as { schemaVersion: number; requirements: unknown[] };
	candidate.featureRequirements = {
		schemaVersion: manifest.schemaVersion,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return Object.freeze({
		project: cloneFramescaperProjectV20(PROFILE, candidate),
		assets: Object.freeze([
			Object.freeze({
				kind: 'video-original', encoding: 'framescaper-video-original-v1',
				storageKey: 'managed-video-original', mimeType: 'video/quicktime', bytes: original,
			}),
			Object.freeze({
				kind: 'video-timing', encoding: originalTiming.reference.encoding,
				storageKey: originalTiming.reference.storageKey,
				mimeType: 'application/vnd.soundscaper.video-timing', bytes: originalTiming.bytes,
			}),
			Object.freeze({
				kind: 'video-proxy', encoding: 'video-proxy-v1',
				storageKey: `video-proxy-sha256:${proxySha}`, mimeType: 'video/quicktime', bytes: proxy,
			}),
			Object.freeze({
				kind: 'video-timing', encoding: proxyTiming.reference.encoding,
				storageKey: proxyTiming.reference.storageKey,
				mimeType: 'application/vnd.soundscaper.video-timing', bytes: proxyTiming.bytes,
			}),
		]),
	});
}

async function productStore(context: TestContext) {
	const store = createFramescaperProjectStoreV20(PROFILE, {
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
	tamperReadBody: string | null;
}

function installBridge(context: TestContext): BridgeHarness {
	const name = 'framescaperDesktop';
	const previous = Object.getOwnPropertyDescriptor(globalThis, name);
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, name, previous);
		else Reflect.deleteProperty(globalThis, name);
	});
	const harness: BridgeHarness = { calls: [], publishedBodies: [], tamperReadBody: null };
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
				publicationId: request.publicationId, maximumChunkBytes: 4 * 1024 * 1024,
				bodyCount: bodies.length,
			};
		},
		connect: async () => { harness.calls.push('connect'); return exactHandshake(); },
		deleteProject: async () => ({ deleted: true }),
		duplicateProject: async (request: Record<string, unknown>) => {
			if (!bundle) throw new Error('missing source');
			const project = JSON.parse(String(bundle.document)) as Record<string, unknown>;
			project.id = request.copyProjectId;
			project.title = request.title;
			project.revision = 0;
			project.createdAt = request.timestamp;
			project.updatedAt = request.timestamp;
			const document = JSON.stringify(project);
			const bytes = new TextEncoder().encode(document);
			metadataRevision += 1;
			bundle = {
				metadataRevision,
				project: {
					id: 'opaque-copy-entry', projectId: project.id, name: project.title,
					metadataFile: 'opaque-copy-entry/project.json', preferredProduct: 'framescaper',
					updatedAtMs: Date.parse(String(project.updatedAt)), projectSchemaVersion: 20,
					projectRevision: 0, byteLength: bytes.byteLength, sha256: digest(bytes),
				},
				document,
				bodies: structuredClone(harness.publishedBodies),
			};
			return structuredClone(bundle);
		},
		finishPublication: async () => {
			if (!pending) throw new Error('missing publication');
			const project = pending.project as Record<string, unknown>;
			const bodies = pending.bodies as Record<string, unknown>[];
			for (const [index, body] of bodies.entries()) {
				committedBytes.set(bodyKey(body), join(pendingBytes[index]!));
			}
			harness.publishedBodies.splice(0, harness.publishedBodies.length, ...structuredClone(bodies));
			const document = JSON.stringify(project);
			const bytes = new TextEncoder().encode(document);
			metadataRevision += 1;
			bundle = {
				metadataRevision,
				project: {
					id: 'opaque-entry-id', projectId: project.id, name: project.title,
					metadataFile: 'opaque-entry-id/project.json', preferredProduct: 'framescaper',
					updatedAtMs: Date.parse(String(project.updatedAt)), projectSchemaVersion: 20,
					projectRevision: project.revision, byteLength: bytes.byteLength,
					sha256: digest(bytes),
				},
				document,
				bodies: structuredClone(bodies),
			};
			pending = null;
			pendingBytes = [];
			return structuredClone(bundle);
		},
		handshakeState: () => 'admitted',
		listProjects: async () => {
			harness.calls.push('listProjects');
			const current = bundle?.project as Record<string, unknown> | undefined;
			return {
				metadataRevision,
				projects: current ? [{
					id: current.projectId, title: current.name, revision: current.projectRevision,
					updatedAt: new Date(Number(current.updatedAtMs)).toISOString(),
				}] : [],
			};
		},
		readBodyChunk: async (request: Record<string, unknown>) => {
			const body = request.body as Record<string, unknown>;
			const bytes = committedBytes.get(bodyKey(body));
			if (!bytes) throw new Error('missing body');
			const result = bytes.slice(Number(request.offset), Number(request.offset) + Number(request.length));
			if (harness.tamperReadBody === body.kind && Number(request.offset) === 0) result[0] ^= 0xff;
			return result;
		},
		readProjectBundle: async () => structuredClone(bundle),
		writePublicationChunk: async (request: Record<string, unknown>) => {
			const bodyIndex = Number(request.bodyIndex);
			const bytes = (request.bytes as Uint8Array).slice();
			pendingBytes[bodyIndex]!.push(bytes);
			const nextOffset = Number(request.offset) + bytes.byteLength;
			const body = (pending!.bodies as Record<string, unknown>[])[bodyIndex]!;
			return { bodyIndex, nextOffset, complete: nextOffset === body.byteLength };
		},
	});
	Object.defineProperty(globalThis, name, {
		configurable: true, enumerable: true, writable: false,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary: api }) }),
	});
	return harness;
}

function exactHandshake() {
	return {
		kind: 'framescaper-project-library-handshake', version: 1, owner: 'framescaper',
		projectSchemaVersion: 20, scapeFormatVersions: [1, 2], attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v20', desktopLibrarySchemaVersion: 12,
		desktopDatabaseUserVersion: 14, desktopLibraryScope: ['kw.media', 'scape-project-library', 'v12'],
	};
}

function bodyKey(body: Record<string, unknown>): string {
	return JSON.stringify([body.kind, body.storageKey]);
}

function blob(bytes: Uint8Array, type: string): Blob {
	return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
