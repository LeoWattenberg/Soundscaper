/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	createFramescaperDesktopLibraryProxyMediaBinding,
} from '../desktop/project-library-v10-media-binding.ts';
import {
	connectFramescaperDesktopProjectLibraryV10Renderer,
} from '../src/framescaper/desktop-project-library-v10-renderer.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { FramescaperScapeArchiveV18 } from '../src/framescaper/scape-project-preservation-v18.ts';
import {
	ARCHIVE_NOW,
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_TIMING,
	archiveProject,
	archiveProxyDescriptors,
	createFramescaperV18ArchiveFixture,
	storedValue,
	type FramescaperV18ArchiveFixture,
} from './helpers/framescaper-v18-archive-fixture.ts';

const PUBLICATION_ID = 'ab'.repeat(24);
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;

test('connects and authenticates before reading or mutating the exact V18 shadow', async (context) => {
	const fixture = await createFramescaperV18ArchiveFixture(context);
	const archive = createArchive(fixture);
	const project = archiveProject();
	const bundle = transferBundle(project, 7);
	const events: string[] = [];
	const bridge = bridgeFixture(bundle, events);
	installBridge(context, bridge.api);

	const renderer = await connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: fixture.store, archive },
	);
	assert.ok(renderer);
	const loaded = await renderer.readProject(String(project.id));

	assert.deepEqual(loaded, project);
	assert.equal(events[0], 'connect');
	assert.deepEqual(events.filter((event) => event.startsWith('body:')), [
		`body:${bundle.bodies[0]!.storageKey}`,
		`body:${bundle.bodies[1]!.storageKey}`,
	]);
	assert.deepEqual(await fixture.store.loadProject(String(project.id)), project);
	assert.ok(await storedValue(fixture.database, 'mediaAssets', bundle.bodies[0]!.storageKey));
	assert.ok(await storedValue(fixture.database, 'mediaAssets', bundle.bodies[1]!.storageKey));
});

test('refuses a mismatched handshake and an incomplete proxy/timing pair without shadow publication', async (context) => {
	const refusedFixture = await createFramescaperV18ArchiveFixture(context);
	const refusedArchive = createArchive(refusedFixture);
	const refusedEvents: string[] = [];
	const refused = bridgeFixture(transferBundle(archiveProject(), 0), refusedEvents, {
		handshake: {
			...createFramescaperDesktopProjectLibraryV10Handshake(),
			desktopLibrarySchemaVersion: 9,
		},
	});
	installBridge(context, refused.api);
	await assert.rejects(connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: refusedFixture.store, archive: refusedArchive },
	), /handshake/iu);
	assert.deepEqual(refusedEvents, ['connect']);
	assert.deepEqual(refusedFixture.store.calls, { metadata: 0, load: 0, begin: 0 });

	const fixture = await createFramescaperV18ArchiveFixture(context);
	const archive = createArchive(fixture);
	const project = archiveProject({ id: 'incomplete-desktop-pair' });
	const bundle = transferBundle(project, 3);
	const events: string[] = [];
	const incomplete = bridgeFixture(bundle, events, { missingTiming: true });
	installBridge(context, incomplete.api);
	const renderer = await connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: fixture.store, archive },
	);
	assert.ok(renderer);
	await assert.rejects(renderer.readProject(String(project.id)), /timing body unavailable/iu);
	assert.equal(await fixture.store.loadProject(String(project.id)), null);
	for (const body of bundle.bodies) {
		assert.equal(await storedValue(fixture.database, 'mediaAssets', body.storageKey), undefined);
	}
});

test('publishes bounded pathless bodies in main before claim-bound shadow reconciliation', async (context) => {
	const fixture = await createFramescaperV18ArchiveFixture(context);
	const archive = createArchive(fixture);
	const current = archiveProject({ id: 'desktop-publication', revision: 0 });
	const currentBundle = transferBundle(current, 11);
	const events: string[] = [];
	const bridge = bridgeFixture(currentBundle, events, {
		beforeFinish: async () => {
			assert.deepEqual(await fixture.store.loadProject(String(current.id)), current);
		},
	});
	installBridge(context, bridge.api);
	const renderer = await connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: fixture.store, archive },
	);
	assert.ok(renderer);
	await renderer.readProject(String(current.id));
	events.length = 0;

	const project = structuredClone(current) as FramescaperProjectV18;
	(project as unknown as { revision: number }).revision = 1;
	(project as unknown as { title: string }).title = 'Published through desktop V10';
	const published = await renderer.publishProject({
		expectedMetadataRevision: currentBundle.metadataRevision,
		expectedProject: {
			projectRevision: currentBundle.project.projectRevision,
			projectSha256: currentBundle.project.sha256,
		},
		project,
	});

	assert.deepEqual(published, project);
	assert.equal(events[0], 'begin');
	const lastWrite = events.reduce((last, event, index) => event.startsWith('write:') ? index : last, -1);
	assert.ok(events.indexOf('finish') > lastWrite);
	assert.ok(events.findIndex((event) => event.startsWith('body:')) > events.indexOf('finish'));
	assert.deepEqual(await fixture.store.loadProject(String(project.id)), project);
	assert.deepEqual(Reflect.ownKeys(bridge.lastBegin!), [
		'expectedMetadataRevision', 'expectedProject', 'project', 'bodies',
	]);
	assertNoRendererAuthority(bridge.lastBegin);
	assert.deepEqual(bridge.uploaded.map(({ storageKey, bytes }) => ({ storageKey, bytes: [...bytes] })), [
		{ storageKey: currentBundle.bodies[0]!.storageKey, bytes: [...ARCHIVE_PROXY_BYTES] },
		{ storageKey: currentBundle.bodies[1]!.storageKey, bytes: [...ARCHIVE_TIMING.bytes] },
	]);
});

interface TransferBody {
	readonly kind: 'video-proxy' | 'video-timing';
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface TransferBundle {
	readonly metadataRevision: number;
	readonly project: Readonly<{
		readonly id: string;
		readonly projectId: string;
		readonly name: string;
		readonly metadataFile: string;
		readonly preferredProduct: 'framescaper';
		readonly updatedAtMs: number;
		readonly projectSchemaVersion: 18;
		readonly projectRevision: number;
		readonly byteLength: number;
		readonly sha256: string;
	}>;
	readonly document: string;
	readonly bodies: readonly Readonly<TransferBody>[];
}

interface BridgeOptions {
	readonly handshake?: unknown;
	readonly missingTiming?: boolean;
	readonly beforeFinish?: () => Promise<void>;
}

function bridgeFixture(initial: TransferBundle, events: string[], options: BridgeOptions = {}) {
	let current = initial;
	let offsets: number[] = [];
	let uploads: Uint8Array[][] = [];
	let activeBodies: readonly Readonly<TransferBody>[] = [];
	let lastBegin: Record<string, unknown> | null = null;
	const bytes = new Map<string, Uint8Array>([
		[initial.bodies[0]!.storageKey, ARCHIVE_PROXY_BYTES],
		[initial.bodies[1]!.storageKey, ARCHIVE_TIMING.bytes],
	]);
	const api = Object.freeze({
		async connect() {
			events.push('connect');
			return options.handshake ?? createFramescaperDesktopProjectLibraryV10Handshake();
		},
		handshakeState: () => 'admitted',
		async readProjectBundle(projectId: string) {
			events.push(`bundle:${projectId}`);
			return projectId === current.project.projectId ? current : null;
		},
		async readBodyChunk(request: Record<string, unknown>) {
			const body = request.body as Readonly<TransferBody>;
			events.push(`body:${body.storageKey}`);
			if (options.missingTiming && body.kind === 'video-timing') {
				throw new Error('timing body unavailable');
			}
			const source = bytes.get(body.storageKey)!;
			const offset = Number(request.offset);
			return source.slice(offset, offset + Number(request.length));
		},
		async beginPublication(request: Record<string, unknown>) {
			events.push('begin');
			lastBegin = structuredClone(request);
			activeBodies = request.bodies as readonly Readonly<TransferBody>[];
			offsets = activeBodies.map(() => 0);
			uploads = activeBodies.map(() => []);
			return { publicationId: PUBLICATION_ID, maximumChunkBytes: MAXIMUM_CHUNK_BYTES, bodyCount: activeBodies.length };
		},
		async writePublicationChunk(request: Record<string, unknown>) {
			const index = Number(request.bodyIndex);
			const chunk = Uint8Array.from(request.bytes as Uint8Array);
			events.push(`write:${String(index)}:${String(request.offset)}`);
			assert.equal(request.publicationId, PUBLICATION_ID);
			assert.equal(request.offset, offsets[index]);
			uploads[index]!.push(chunk);
			offsets[index]! += chunk.byteLength;
			return { bodyIndex: index, nextOffset: offsets[index], complete: offsets[index] === activeBodies[index]!.byteLength };
		},
		async finishPublication(request: Record<string, unknown>) {
			events.push('finish');
			assert.equal(request.publicationId, PUBLICATION_ID);
			await options.beforeFinish?.();
			const project = (lastBegin as { project: FramescaperProjectV18 }).project;
			const next = transferBundle(project, Number(lastBegin!.expectedMetadataRevision) + 1);
			assert.deepEqual(activeBodies, next.bodies);
			for (const [index, body] of activeBodies.entries()) bytes.set(body.storageKey, join(uploads[index]!));
			current = next;
			return next;
		},
		async abortPublication(request: Record<string, unknown>) {
			events.push('abort');
			assert.equal(request.publicationId, PUBLICATION_ID);
			return true;
		},
	});
	return {
		api,
		get lastBegin() { return lastBegin; },
		get uploaded() {
			return activeBodies.map((body, index) => ({ storageKey: body.storageKey, bytes: join(uploads[index]!) }));
		},
	};
}

function transferBundle(project: FramescaperProjectV18, metadataRevision: number): TransferBundle {
	const document = JSON.stringify(project);
	const documentBytes = new TextEncoder().encode(document);
	const projectSha256 = digest(documentBytes);
	const entryId = 'desktop_entry_01';
	const row = Object.freeze({
		id: entryId,
		projectId: String(project.id),
		name: String(project.title),
		metadataFile: `${entryId}/${String(project.revision)}-${projectSha256}.json`,
		preferredProduct: 'framescaper' as const,
		updatedAtMs: ARCHIVE_NOW,
		projectSchemaVersion: 18 as const,
		projectRevision: Number(project.revision),
		byteLength: documentBytes.byteLength,
		sha256: projectSha256,
	});
	const bodies = archiveProxyDescriptors().map((asset): Readonly<TransferBody> => {
		const common = {
			sourceId: String(asset.sourceId), storageKey: String(asset.sourceId),
			mimeType: String(asset.mimeType), byteLength: Number(asset.size), sha256: String(asset.sha256),
		};
		if (asset.kind === 'video-proxy') return Object.freeze({
			kind: 'video-proxy', encoding: 'video-proxy-v1',
			bindingId: createFramescaperDesktopLibraryProxyMediaBinding(
				String(project.id), String(asset.sourceId), Number(project.revision), projectSha256,
			).id,
			...common,
		});
		return Object.freeze({ kind: 'video-timing', encoding: String(asset.encoding), ...common });
	});
	return Object.freeze({ metadataRevision, project: row, document, bodies: Object.freeze(bodies) });
}

function createArchive(fixture: FramescaperV18ArchiveFixture): FramescaperScapeArchiveV18 {
	let generation = 0;
	return new FramescaperScapeArchiveV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		store: fixture.store, port: fixture.port, opfs: fixture.opfs,
		now: () => ARCHIVE_NOW,
		createGeneration: () => `desktop-renderer-${String(++generation).padStart(8, '0')}`,
	});
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

function assertNoRendererAuthority(value: unknown): void {
	const forbidden = /^(?:lease|leaseId|owner|path|file|callback|chunks)$/iu;
	const visit = (candidate: unknown): void => {
		if (!candidate || typeof candidate !== 'object') return;
		for (const key of Reflect.ownKeys(candidate)) {
			if (typeof key === 'string') assert.doesNotMatch(key, forbidden);
			visit((candidate as Record<PropertyKey, unknown>)[key]);
		}
	};
	visit(value);
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
