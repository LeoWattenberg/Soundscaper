/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../../desktop/project-library-v10-contract.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../../src/common/editor/project-v10.ts';
import type { AudioEditorProjectStoreOptions } from '../../src/common/editor/storage/project-store-options.ts';
import {
	connectFramescaperDesktopProjectLibraryV10Renderer,
	type FramescaperDesktopProjectLibraryV10Renderer,
	type FramescaperDesktopProjectLibraryV10ShadowStore,
} from '../../src/framescaper/desktop-project-library-v10-renderer.ts';
import {
	createFramescaperDesktopProjectStoreV10Adapter,
	type FramescaperDesktopProjectStoreV10Adapter,
} from '../../src/framescaper/desktop-project-library-v10-store-adapter.ts';
import {
	createFramescaperProjectStoreV18,
	framescaperProjectStoreAuthorityV18,
} from '../../src/framescaper/editor-project-store-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../../src/framescaper/editor-project-v18.ts';
import { FramescaperScapeArchiveV18 } from '../../src/framescaper/scape-project-preservation-v18.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export type FramescaperDesktopV10LocalStore = ReturnType<typeof createFramescaperProjectStoreV18>;

export interface FramescaperDesktopV10LifecycleFixture {
	readonly localStore: FramescaperDesktopV10LocalStore;
	readonly store: FramescaperDesktopProjectStoreV10Adapter<FramescaperDesktopV10LocalStore>;
	readonly renderer: FramescaperDesktopProjectLibraryV10Renderer;
	readonly main: FramescaperDesktopV10MainFixture;
}

export interface FramescaperDesktopV10FixtureEnvironment {
	readonly indexedDB?: IDBFactory;
	readonly main?: FramescaperDesktopV10MainFixture;
}

export async function lifecycleFixture(
	context: TestContext,
	storeOptions: AudioEditorProjectStoreOptions = {},
	environment: FramescaperDesktopV10FixtureEnvironment = {},
): Promise<FramescaperDesktopV10LifecycleFixture> {
	const base = await baseFixture(context, storeOptions, environment);
	installFramescaperDesktopV10Bridge(context, base.main.api);
	const renderer = await connectFramescaperDesktopProjectLibraryV10Renderer(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ store: base.localStore as unknown as FramescaperDesktopProjectLibraryV10ShadowStore, archive: base.archive },
	);
	assert.ok(renderer);
	const store = createFramescaperDesktopProjectStoreV10Adapter(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ localStore: base.localStore, desktopProjectLibrary: renderer },
	);
	return { localStore: base.localStore, store, renderer, main: base.main };
}

export async function webLifecycleFixture(
	context: TestContext,
	storeOptions: AudioEditorProjectStoreOptions = {},
	environment: FramescaperDesktopV10FixtureEnvironment = {},
) {
	const base = await baseFixture(context, storeOptions, environment);
	return { localStore: base.localStore, store: base.localStore, main: base.main };
}

export class FramescaperDesktopV10MainFixture {
	readonly events: string[] = [];
	readonly reads: string[] = [];
	readonly api;
	beginFailure: Error | null = null;
	acceptBodies = false;
	afterUpload: (() => Promise<void>) | null = null;
	beforeFinish: (() => Promise<void>) | null = null;
	beforeDuplicate: (() => PromiseLike<void> | void) | null = null;
	afterDuplicate: (() => PromiseLike<void> | void) | null = null;
	beforeRead: ((projectId: string) => PromiseLike<void> | void) | null = null;
	afterFinishCommit: (() => PromiseLike<void> | void) | null = null;
	finishFailureAfterCommit: Error | null = null;
	duplicateFailureAfterCommit: Error | null = null;
	deleteFailureAfterCommit: Error | null = null;
	readonly readFailures = new Map<string, Error>();
	readonly readFailureCounts = new Map<string, number>();
	lastBegin: Record<string, unknown> | null = null;
	#metadataRevision = 0;
	#projects = new Map<string, FramescaperProjectV18>();
	#active: FramescaperProjectV18 | null = null;
	#activePublicationId: string | null = null;
	#activeBodyDescriptors: Record<string, unknown>[] = [];
	#activeBodyBytes: Uint8Array[] = [];
	#activeBodyOffsets: number[] = [];
	#projectBodies = new Map<string, Readonly<{
		descriptors: readonly Record<string, unknown>[];
		bytes: readonly Uint8Array[];
	}>>();
	#connected = false;
	#publications = 0;

	constructor() {
		this.api = Object.freeze({
			connect: async () => { this.#connected = true; return createFramescaperDesktopProjectLibraryV10Handshake(); },
			handshakeState: () => this.#connected ? 'admitted' : 'pending',
			listProjects: async () => ({
				metadataRevision: this.#metadataRevision,
				projects: [...this.#projects.values()].map((project) => ({
					id: String(project.id), title: String(project.title), revision: Number(project.revision),
					updatedAt: String(project.updatedAt),
				})),
			}),
			readProjectBundle: async (projectId: string) => {
				this.reads.push(projectId);
				await this.beforeRead?.(projectId);
				const failure = this.readFailures.get(projectId);
				const remaining = this.readFailureCounts.get(projectId);
				if (failure && (remaining === undefined || remaining > 0)) {
					if (remaining !== undefined) this.readFailureCounts.set(projectId, remaining - 1);
					throw failure;
				}
				const project = this.#projects.get(projectId);
				return project ? bundle(project, this.#metadataRevision, this.#projectBodies.get(projectId)?.descriptors) : null;
			},
			readBodyChunk: async (request: Record<string, unknown>) => this.#readBodyChunk(request),
			beginPublication: async (request: Record<string, unknown>) => this.#begin(request),
			writePublicationChunk: async (request: Record<string, unknown>) => this.#writeBodyChunk(request),
			finishPublication: async (request: Record<string, unknown>) => this.#finish(request),
			abortPublication: async () => { this.#clearActive(); return true; },
			deleteProject: async (request: Record<string, unknown>) => this.#delete(request),
			duplicateProject: async (request: Record<string, unknown>) => this.#duplicate(request),
		});
	}

	get publications(): number { return this.#publications; }

	failNextReads(projectId: string, count: number, error: Error): void {
		assert.ok(Number.isSafeInteger(count) && count > 0);
		this.readFailures.set(projectId, error);
		this.readFailureCounts.set(projectId, count);
	}

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
		} else if (!current || Number(current.revision) !== expected.projectRevision
			|| digest(new TextEncoder().encode(JSON.stringify(current))) !== expected.projectSha256) {
			throw new Error('project CAS stale');
		}
		if (this.beginFailure) throw this.beginFailure;
		const descriptors = structuredClone(request.bodies) as Record<string, unknown>[];
		if (!this.acceptBodies) assert.deepEqual(descriptors, []);
		this.#active = project;
		this.#activePublicationId = String(request.publicationId);
		this.#activeBodyDescriptors = descriptors;
		this.#activeBodyBytes = descriptors.map(({ byteLength }) => new Uint8Array(Number(byteLength)));
		this.#activeBodyOffsets = descriptors.map(() => 0);
		return {
			publicationId: this.#activePublicationId,
			maximumChunkBytes: 4 * 1024 * 1024,
			bodyCount: descriptors.length,
		};
	}

	async #writeBodyChunk(request: Record<string, unknown>) {
		assert.equal(request.publicationId, this.#activePublicationId);
		const bodyIndex = Number(request.bodyIndex);
		const offset = Number(request.offset);
		const bytes = request.bytes;
		assert.ok(bytes instanceof Uint8Array);
		assert.equal(offset, this.#activeBodyOffsets[bodyIndex]);
		const body = this.#activeBodyBytes[bodyIndex];
		assert.ok(body && offset + bytes.byteLength <= body.byteLength);
		body.set(bytes, offset);
		const nextOffset = offset + bytes.byteLength;
		this.#activeBodyOffsets[bodyIndex] = nextOffset;
		if (this.#activeBodyOffsets.every((candidateOffset, index) => (
			candidateOffset === this.#activeBodyBytes[index]!.byteLength
		))) await this.afterUpload?.();
		return { bodyIndex, nextOffset, complete: nextOffset === body.byteLength };
	}

	#readBodyChunk(request: Record<string, unknown>): Uint8Array {
		const projectId = String(request.projectId);
		const stored = this.#projectBodies.get(projectId);
		if (!stored) throw new Error('Format-1 fixture has no desktop bodies.');
		const storageKey = String((request.body as Record<string, unknown>).storageKey);
		const index = stored.descriptors.findIndex((descriptor) => descriptor.storageKey === storageKey);
		assert.notEqual(index, -1);
		const offset = Number(request.offset);
		return stored.bytes[index]!.slice(offset, offset + Number(request.length));
	}

	async #finish(request: Record<string, unknown>) {
		this.events.push('finish');
		assert.equal(request.publicationId, this.#activePublicationId);
		assert.ok(this.#active);
		await this.beforeFinish?.();
		const project = this.#active;
		assert.ok(this.#activeBodyBytes.every((body, index) => this.#activeBodyOffsets[index] === body.byteLength));
		const descriptors = structuredClone(this.#activeBodyDescriptors);
		const bytes = this.#activeBodyBytes.map((body) => body.slice());
		this.#clearActive();
		this.#projects.set(String(project.id), structuredClone(project));
		this.#projectBodies.set(String(project.id), { descriptors, bytes });
		this.#metadataRevision += 1;
		this.#publications += 1;
		await this.afterFinishCommit?.();
		if (this.finishFailureAfterCommit) throw this.finishFailureAfterCommit;
		return bundle(project, this.#metadataRevision, descriptors);
	}

	#clearActive(): void {
		this.#active = null;
		this.#activePublicationId = null;
		this.#activeBodyDescriptors = [];
		this.#activeBodyBytes = [];
		this.#activeBodyOffsets = [];
	}

	async #delete(request: Record<string, unknown>) {
		const projectId = String(request.projectId);
		const current = this.#projects.get(projectId);
		assert.ok(current);
		assert.equal(request.expectedMetadataRevision, this.#metadataRevision);
		const expected = request.expectedProject as { projectRevision: number; projectSha256: string };
		assert.equal(expected.projectRevision, current.revision);
		assert.equal(expected.projectSha256, digest(new TextEncoder().encode(JSON.stringify(current))));
		this.#projects.delete(projectId);
		this.#metadataRevision += 1;
		if (this.deleteFailureAfterCommit) throw this.deleteFailureAfterCommit;
		return { projectId, metadataRevision: this.#metadataRevision, deleted: true };
	}

	async #duplicate(request: Record<string, unknown>) {
		await this.beforeDuplicate?.();
		const sourceId = String(request.sourceProjectId);
		const copyId = String(request.copyProjectId);
		const source = this.#projects.get(sourceId);
		assert.ok(source);
		assert.equal(this.#projects.has(copyId), false);
		assert.equal(request.expectedMetadataRevision, this.#metadataRevision);
		const expected = request.expectedSource as { projectRevision: number; projectSha256: string };
		assert.equal(expected.projectRevision, source.revision);
		assert.equal(expected.projectSha256, digest(new TextEncoder().encode(JSON.stringify(source))));
		const copy = structuredClone(source) as unknown as MutableFramescaperProject & FramescaperProjectV18;
		copy.id = copyId;
		copy.title = String(request.title);
		copy.revision = 0;
		copy.createdAt = String(request.timestamp);
		copy.updatedAt = String(request.timestamp);
		for (const group of copy.multicameraGroups) group.projectId = copyId;
		this.#projects.set(copyId, copy);
		this.#metadataRevision += 1;
		await this.afterDuplicate?.();
		if (this.duplicateFailureAfterCommit) throw this.duplicateFailureAfterCommit;
		return bundle(copy, this.#metadataRevision);
	}
}

export function projectFixture(options: Readonly<{
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
				id: 'desktop-nested-placement', sequenceId: 'main-sequence',
				sourceSequenceId: 'nested-source-sequence', sequenceStartFrame: 0,
				sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
			}],
		} : {}),
	});
	return { ...project, revision: options.revision };
}

export interface MutableFramescaperProject extends Record<string, unknown> {
	id: string;
	revision: number;
	title: string;
	createdAt: string;
	updatedAt: string;
	multicameraGroups: Array<{ activeMemberId: string; projectId: string }>;
}

async function baseFixture(
	context: TestContext,
	storeOptions: AudioEditorProjectStoreOptions,
	environment: FramescaperDesktopV10FixtureEnvironment,
) {
	const localStore = createFramescaperProjectStoreV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		...storeOptions,
		indexedDB: environment.indexedDB
			?? createInstrumentedIndexedDB() as unknown as IDBFactory,
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
	return { localStore, archive, main: environment.main ?? new FramescaperDesktopV10MainFixture() };
}

function bundle(
	project: FramescaperProjectV18,
	metadataRevision: number,
	bodies: readonly Record<string, unknown>[] = [],
) {
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
		bodies: structuredClone(bodies),
	};
}

export function installFramescaperDesktopV10Bridge(context: TestContext, api: unknown): void {
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

function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
