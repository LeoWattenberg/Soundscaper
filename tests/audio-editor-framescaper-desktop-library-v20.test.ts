/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { collectProjectStorageKeys } from '../src/common/editor/retention.js';
import {
	collectFramescaperDesktopV31AssistanceBodyReferences,
	validateFramescaperDesktopV31Bodies,
} from '../src/framescaper/desktop-project-library-v31-body-contract.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE } from '../src/framescaper/desktop-project-library-v20-renderer-contract.ts';
import { createFramescaperEditorProjectEnvironmentV31 } from '../src/framescaper/editor-project-environment-v31.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import { createFramescaperProjectV31 } from '../src/framescaper/editor-project-v31.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const SOURCE_SHA256 = 'ab'.repeat(32);
const BODY_SHA256 = 'cd'.repeat(32);
const MODEL_SHA256 = 'ef'.repeat(32);
const PROJECT_SHA256 = '12'.repeat(32);

test('desktop V20 body custody extends the entire V28 inventory with transcript bodies', () => {
	const project = projectWithTranscript();
	const references = collectFramescaperDesktopV31AssistanceBodyReferences(project);
	assert.equal(references.length, 1);
	assert.equal(references[0]?.descriptor.storageKey,
		`assistance-transcript-sha256:${BODY_SHA256}`);
	assert.deepEqual(
		validateFramescaperDesktopV31Bodies(
			project, PROJECT_SHA256, references.map(({ descriptor }) => descriptor),
		),
		references.map(({ descriptor }) => descriptor),
	);
	assert.throws(
		() => validateFramescaperDesktopV31Bodies(project, PROJECT_SHA256, []),
		/body inventory/iu,
	);
	assert.equal(collectProjectStorageKeys(project).has(references[0]!.descriptor.storageKey), true);
});

test('desktop V20 renderer admits only its exact F31 handshake and overlays the local store', async (context) => {
	installDesktopLibrary(context, { ...FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE });
	const environment = await createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.ok(environment.desktopProjectLibrary);
	assert.notEqual(environment.controllerStore, environment.store);
	assert.deepEqual(await environment.controllerStore.listProjects(), []);
});

test('desktop V20 renderer refuses a neighboring library identity', async (context) => {
	installDesktopLibrary(context, {
		...FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE,
		desktopDatabaseUserVersion: 21,
	});
	await assert.rejects(createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	}), /handshake identity/iu);
});

test('desktop V20 renderer publishes and reacquires transcript bodies with F31 intact', async (context) => {
	const body = new TextEncoder().encode('{"segments":[]}');
	const bodySha256 = digest(body);
	const project = projectWithTranscript(bodySha256, body.byteLength);
	const harness = installPublicationDesktopLibrary(context);
	const environment = await createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	await environment.store.writeMediaAsset(
		`assistance-transcript-sha256:${bodySha256}`,
		new Blob([body.slice().buffer as ArrayBuffer], {
			type: 'application/vnd.soundscaper.assistance-transcript+json',
		}),
		{
			kind: 'assistance-transcript', encoding: 'assistance-transcript-v1',
			mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
			name: 'Transcript',
		},
	);
	assert.ok(environment.desktopProjectLibrary);
	assert.deepEqual(await environment.desktopProjectLibrary.publishProject({ project }), project);
	assert.deepEqual(harness.publishedKinds, ['assistance-transcript']);
	await environment.store.deleteMediaAsset(`assistance-transcript-sha256:${bodySha256}`);
	assert.deepEqual(await environment.desktopProjectLibrary.readProject(String(project.id)), project);
	const restored = await environment.store.loadMediaAsset(`assistance-transcript-sha256:${bodySha256}`);
	assert.ok(restored);
	assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), body);
});

function installDesktopLibrary(
	context: TestContext,
	handshake: Readonly<Record<string, unknown>>,
): void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	let admitted = false;
	const projectLibrary = Object.freeze({
		connect: async () => { admitted = true; return structuredClone(handshake); },
		handshakeState: () => admitted ? 'admitted' : 'pending',
		listProjects: async () => ({ metadataRevision: 0, projects: [] }),
		readProjectBundle: async () => null,
		readBodyChunk: async () => { throw new Error('no body'); },
		beginPublication: async () => { throw new Error('no publication'); },
		writePublicationChunk: async () => { throw new Error('no publication'); },
		finishPublication: async () => { throw new Error('no publication'); },
		abortPublication: async () => false,
		deleteProject: async () => { throw new Error('no project'); },
		duplicateProject: async () => { throw new Error('no project'); },
	});
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true,
		enumerable: true,
		writable: false,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary }) }),
	});
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'framescaperDesktop', descriptor);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
}

function installPublicationDesktopLibrary(context: TestContext): Readonly<{
	readonly publishedKinds: string[];
}> {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	let metadataRevision = 0;
	let bundle: Record<string, unknown> | null = null;
	let pending: Record<string, unknown> | null = null;
	let pendingBytes: Uint8Array[][] = [];
	const committedBytes = new Map<string, Uint8Array>();
	const publishedKinds: string[] = [];
	const projectLibrary = Object.freeze({
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
		connect: async () => structuredClone(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE),
		deleteProject: async (request: Record<string, unknown>) => ({
			projectId: request.projectId, metadataRevision: ++metadataRevision, deleted: true,
		}),
		duplicateProject: async () => { throw new Error('not used'); },
		finishPublication: async () => {
			if (!pending) throw new Error('missing publication');
			const project = pending.project as Record<string, unknown>;
			const bodies = pending.bodies as Record<string, unknown>[];
			for (const [index, body] of bodies.entries()) {
				committedBytes.set(bodyKey(body), concatenate(pendingBytes[index]!));
			}
			publishedKinds.splice(0, publishedKinds.length, ...bodies.map(({ kind }) => String(kind)));
			const document = JSON.stringify(project);
			const bytes = new TextEncoder().encode(document);
			metadataRevision += 1;
			bundle = {
				metadataRevision,
				project: {
					id: 'opaque-entry', projectId: project.id, name: project.title,
					metadataFile: 'opaque-entry/project.json', preferredProduct: 'framescaper',
					updatedAtMs: Date.parse(String(project.updatedAt)), projectSchemaVersion: 31,
					projectRevision: project.revision, byteLength: bytes.byteLength, sha256: digest(bytes),
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
			const body = (pending!.bodies as Record<string, unknown>[])[bodyIndex]!;
			return { bodyIndex, nextOffset, complete: nextOffset === body.byteLength };
		},
	});
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true, enumerable: true, writable: false,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary }) }),
	});
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'framescaperDesktop', descriptor);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
	return { publishedKinds };
}

function projectWithTranscript(bodySha256 = BODY_SHA256, bodyByteLength = 1_024) {
	const source = createAudioSource({
		id: 'dialogue-audio', name: 'Dialogue', mimeType: 'audio/wav',
		storageKey: 'owned:dialogue-audio', contentSha256: SOURCE_SHA256,
		frameCount: 96_000, sampleRate: 48_000, channelCount: 2,
	});
	return createFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v31-desktop', title: 'Desktop transcript',
		now: '2026-08-25T00:00:00.000Z', sources: [source],
		assistanceAssets: [{
			id: 'transcript-01', kind: 'transcript-v1', sourceId: source.id,
			sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 96_000,
			sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
			modelArtifactSha256s: [MODEL_SHA256], body: {
				storageKey: `assistance-transcript-sha256:${bodySha256}`,
				mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
				byteLength: bodyByteLength, sha256: bodySha256,
			},
		}],
	} as never);
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function bodyKey(body: Record<string, unknown>): string {
	return JSON.stringify([body.kind, body.storageKey]);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}
