/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { TestContext } from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../../src/common/editor/project-v10.ts';
import type { ScapeArchiveEntry } from '../../src/common/editor/scape-archive-envelope.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { KeyValueRepository } from '../../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';
import {
	bindEditorProjectStoreProfile,
} from '../../src/common/editor/storage/project-store-profile-binding.ts';
import type { StorageRepositoryPort } from '../../src/common/editor/storage/repository-port.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../../src/common/editor/storage/media-asset-write-contract.ts';
import { createVideoTimingAssetPublication } from '../../src/common/editor/video-timing-asset.ts';
import {
	editorProjectRuntimeProfileDefinition,
} from '../../src/common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../../src/common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export const ARCHIVE_PROJECT_ID = 'framescaper-v18-archive';
export const ARCHIVE_SOURCE_ID = 'archive-video';
export const ARCHIVE_ORIGINAL_BYTES = Uint8Array.from(
	{ length: 211 },
	(_, index) => (index * 29 + 7) & 0xff,
);
export const ARCHIVE_ORIGINAL_SHA = digest(ARCHIVE_ORIGINAL_BYTES);
export const ARCHIVE_NOW = 1_786_550_400_000;
export const ARCHIVE_PROXY_BYTES = Uint8Array.from({ length: 137 }, (_, index) => (index * 17) & 0xff);
export const ARCHIVE_PROXY_SHA = digest(ARCHIVE_PROXY_BYTES);
export const ARCHIVE_TIMING = createVideoTimingAssetPublication(ARCHIVE_PROXY_SHA, {
	timescale: 10,
	presentationTicks: [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n],
	finalFrameDurationTicks: 1n,
});

export interface FramescaperV18ArchiveFixture {
	readonly database: IDBDatabase;
	readonly port: StorageRepositoryPort;
	readonly opfs: OpfsRepository;
	readonly store: FixtureArchiveStore;
	readonly files: Map<string, Blob>;
}

export class FixtureArchiveStore {
	readonly databaseName: string;
	readonly memory;
	readonly opfsRepository: OpfsRepository;
	readonly projectRepository: Readonly<{
		delete(projectId: string): Promise<void>;
		deleteExact(project: Readonly<Record<string, unknown>>): Promise<boolean>;
	}>;
	readonly settingsRepository: KeyValueRepository;
	readonly linkedOriginalStoreService = Object.freeze({
		deleteProject: async <Value>(_projectId: string, operation: () => PromiseLike<Value> | Value) => operation(),
	});
	readonly calls = { metadata: 0, load: 0, begin: 0 };
	readonly #database: IDBDatabase;
	readonly #files: Map<string, Blob>;
	#generation = 0;

	constructor(
		databaseName: string,
		database: IDBDatabase,
		port: StorageRepositoryPort,
		opfs: OpfsRepository,
		files: Map<string, Blob>,
	) {
		this.databaseName = databaseName;
		this.memory = port.memory;
		this.opfsRepository = opfs;
		this.#database = database;
		this.#files = files;
		this.settingsRepository = new KeyValueRepository(port, 'settings');
		this.projectRepository = Object.freeze({
			delete: async (projectId: string) => {
				await transact(this.#database, 'projects', 'readwrite', ({ projects }) => {
					projects.delete(projectId);
				});
			},
			deleteExact: async (project) => {
				const current = await this.loadProject(String(project.id));
				if (JSON.stringify(current) !== JSON.stringify(project)) return false;
				await transact(this.#database, 'projects', 'readwrite', ({ projects }) => {
					projects.delete(String(project.id));
				});
				return true;
			},
		});
		const runtime = editorProjectRuntimeProfileDefinition(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
		const storageProfile = editorProjectRuntimeProfilePrerequisiteDefinition(
			runtime.prerequisite,
		).storageProfile;
		bindEditorProjectStoreProfile(this, storageProfile);
	}

	getStatus() {
		return Object.freeze({ state: 'indexeddb', persistent: true });
	}

	async getMediaAssetMetadata(sourceId: string): Promise<Record<string, unknown> | null> {
		this.calls.metadata += 1;
		const value = await transact(this.#database, 'mediaAssets', 'readonly', ({ mediaAssets }) => (
			request(mediaAssets.get(sourceId))
		));
		return value && typeof value === 'object' ? structuredClone(value) as Record<string, unknown> : null;
	}

	async getSourceMetadata(): Promise<null> { return null; }

	async *readSourceChunks(): AsyncGenerator<never> { return; }

	async beginSourceWrite(): Promise<never> {
		throw new Error('This video-only archive fixture does not stage audio.');
	}

	async discardSourceIfCurrent(): Promise<boolean> { return false; }

	async loadProject(
		projectId: string,
		options: Readonly<{ revision?: number }> = {},
	): Promise<Record<string, unknown> | null> {
		const value = options.revision === undefined
			? await transact(this.#database, 'projects', 'readonly', ({ projects }) => request(projects.get(projectId)))
			: await transact(this.#database, 'revisions', 'readonly', ({ revisions }) => request(revisions.get(
				`${projectId}:${String(options.revision).padStart(12, '0')}`,
			)));
		const project = options.revision === undefined
			? value
			: value && typeof value === 'object' ? (value as Record<string, unknown>).project : null;
		return project && typeof project === 'object'
			? structuredClone(project) as Record<string, unknown>
			: null;
	}

	async loadMediaAsset(sourceId: string): Promise<Blob | null> {
		this.calls.load += 1;
		const row = await this.getMediaAssetMetadata(sourceId);
		return typeof row?.path === 'string' ? this.#files.get(row.path) ?? null : null;
	}

	async beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<OwnedMediaAssetWriter> {
		this.calls.begin += 1;
		if (await this.getMediaAssetMetadata(sourceId)) throw new Error('occupied immutable body');
		const chunks: Uint8Array[] = [];
		let size = 0;
		let closed = false;
		const generation = ++this.#generation;
		const path = `archive/${String(generation).padStart(4, '0')}-${options.expectedSha256}.bin`;
		const token = `media-content-archive-${String(generation).padStart(16, '0')}`;
		const abort = async (): Promise<void> => { closed = true; chunks.length = 0; };
		const commitOwned = async (): Promise<OwnedMediaAssetPublication> => {
			if (closed) throw new Error('writer closed');
			closed = true;
			const bytes = join(chunks, size);
			if (size !== options.expectedBytes || digest(bytes) !== options.expectedSha256) {
				throw new Error('fixture writer digest mismatch');
			}
			const blob = new Blob([exactBuffer(bytes)], { type: String(metadata.mimeType ?? '') });
			const row = {
				...structuredClone(metadata), sourceId, storage: 'opfs', path,
				mediaContentDigestVersion: 1, mediaContentToken: token,
				sha256: options.expectedSha256, size, mimeType: String(metadata.mimeType ?? ''),
				committedAt: '2026-08-13T10:00:00.000Z',
				pendingProjectUntil: '2026-08-14T10:00:00.000Z',
			};
			this.#files.set(path, blob);
			await transact(this.#database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
				mediaAssets.put(row);
			});
			let current = true;
			return {
				metadata: structuredClone(row),
				discardIfCurrent: async () => {
					if (!current) return false;
					current = false;
					const removed = await transact(
						this.#database,
						'mediaAssets',
						'readwrite',
						async ({ mediaAssets }) => {
							const stored = await request(mediaAssets.get(sourceId)) as Record<string, unknown> | undefined;
							if (stored?.mediaContentToken !== token) return false;
							await request(mediaAssets.delete(sourceId));
							return true;
						},
					);
					if (removed) this.#files.delete(path);
					return removed;
				},
			};
		};
		return {
			maximumChunkBytes: 4 * 1024 * 1024,
			get bytesWritten() { return size; },
			write: async (bytes) => {
				if (closed) throw new Error('writer closed');
				const snapshot = bytes.slice();
				chunks.push(snapshot);
				size += snapshot.byteLength;
			},
			commit: async () => (await commitOwned()).metadata,
			commitOwned,
			abort,
		};
	}
}

export async function createFramescaperV18ArchiveFixture(
	context: TestContext,
): Promise<FramescaperV18ArchiveFixture> {
	const databaseName = 'kw-media-framescaper-editor-v18';
	const database = await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName);
	if (database.name === undefined) Object.defineProperty(database, 'name', { value: databaseName });
	context.after(() => database.close());
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(`${databaseName}-${Math.random().toString(36).slice(2)}`),
		database: async () => database,
	};
	const files = new Map<string, Blob>();
	const opfs = new OpfsRepository({ preferOpfs: true, opfsRoot: opfsRoot(files) });
	return {
		database,
		port,
		opfs,
		files,
		store: new FixtureArchiveStore(databaseName, database, port, opfs, files),
	};
}

export function archiveProject(
	options: Readonly<{ id?: string; revision?: number; attached?: boolean; title?: string }> = {},
): FramescaperProjectV18 {
	const base = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: options.id ?? ARCHIVE_PROJECT_ID,
		title: options.title ?? 'Framescaper archive',
		now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSourceV10({
			id: ARCHIVE_SOURCE_ID, name: 'Video', storageKey: ARCHIVE_SOURCE_ID, mimeType: 'video/mp4',
			contentSha256: ARCHIVE_ORIGINAL_SHA, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'archive-clip', sourceId: ARCHIVE_SOURCE_ID, title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['archive-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
	const project = structuredClone(base) as unknown as Record<string, unknown>;
	project.revision = options.revision ?? 0;
	if (options.attached !== false) {
		((project.sources as Record<string, unknown>[])[0]!).proxyAttachment = archiveAttachment();
		const manifest = project.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
		project.featureRequirements = {
			schemaVersion: manifest.schemaVersion,
			requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
		};
	}
	return project as unknown as FramescaperProjectV18;
}

export function archiveCopy(
	project: FramescaperProjectV18,
	id = 'framescaper-v18-archive-copy',
): FramescaperProjectV18 {
	return {
		...structuredClone(project), id, title: `${project.title} copy`, revision: 0,
		createdAt: '2026-08-13T11:00:00.000Z', updatedAt: '2026-08-13T11:00:00.000Z',
	};
}

export function archiveManifest(project: FramescaperProjectV18): Record<string, unknown> {
	return {
		format: 'scape-project', formatVersion: 2, createdAt: '2026-08-13T10:00:00.000Z',
		project: {
			entry: 'project.json', mimeType: 'application/json', schemaVersion: project.schemaVersion,
			size: 4_096, sha256: '78'.repeat(32),
		},
		assets: [{
			sourceId: ARCHIVE_SOURCE_ID, kind: 'video', encoding: 'original',
			entry: `media/${ARCHIVE_SOURCE_ID}/original`, mimeType: 'video/mp4',
			size: ARCHIVE_ORIGINAL_BYTES.byteLength,
			sha256: ARCHIVE_ORIGINAL_SHA,
		}, ...archiveProxyDescriptors()],
	};
}

export function archiveProxyDescriptors(): Record<string, unknown>[] {
	return [{
		sourceId: `video-proxy-sha256:${ARCHIVE_PROXY_SHA}`,
		kind: 'video-proxy', encoding: 'video-proxy-v1',
		entry: `proxy/${ARCHIVE_PROXY_SHA}/body`, mimeType: 'video/mp4',
		size: ARCHIVE_PROXY_BYTES.byteLength, sha256: ARCHIVE_PROXY_SHA,
	}, {
		sourceId: ARCHIVE_TIMING.reference.storageKey,
		kind: 'video-timing', encoding: 'soundscaper-video-timing-v1',
		entry: `timing/${ARCHIVE_TIMING.reference.sha256}.scti`,
		mimeType: 'application/vnd.soundscaper.video-timing',
		size: ARCHIVE_TIMING.bytes.byteLength, sha256: ARCHIVE_TIMING.reference.sha256,
	}];
}

export function archiveEntries(
	onRead: (entry: string) => void = () => undefined,
	overrides: Readonly<{ proxy?: Uint8Array; timing?: Uint8Array }> = {},
): ScapeArchiveEntry[] {
	const descriptors = archiveProxyDescriptors();
	return [
		archiveEntry(descriptors[0]!, overrides.proxy ?? ARCHIVE_PROXY_BYTES, onRead),
		archiveEntry(descriptors[1]!, overrides.timing ?? ARCHIVE_TIMING.bytes, onRead),
	];
}

export async function seedFramescaperV18ArchiveBodies(
	fixture: FramescaperV18ArchiveFixture,
	attached = true,
): Promise<void> {
	const bodies: Array<Readonly<{
		descriptor: Record<string, unknown>;
		bytes: Uint8Array;
		metadata?: Record<string, unknown>;
	}>> = [{
		descriptor: (archiveManifest(archiveProject()).assets as Record<string, unknown>[])[0]!,
		bytes: ARCHIVE_ORIGINAL_BYTES,
	}];
	if (attached) {
		for (const [index, bytes] of [ARCHIVE_PROXY_BYTES, ARCHIVE_TIMING.bytes].entries()) {
			bodies.push({
				descriptor: archiveProxyDescriptors()[index]!,
				bytes,
				...(index === 1 ? { metadata: {
					frameCount: ARCHIVE_TIMING.reference.frameCount,
					timescale: ARCHIVE_TIMING.reference.timescale,
					finalFrameDurationTicks: ARCHIVE_TIMING.reference.finalFrameDurationTicks,
				} } : {}),
			});
		}
	}
	for (const { descriptor, bytes, metadata = {} } of bodies) {
		const writer = await fixture.store.beginMediaAssetWrite(String(descriptor.sourceId), {
			name: String(descriptor.entry), kind: descriptor.kind, encoding: descriptor.encoding,
			mimeType: descriptor.mimeType, ...metadata,
		}, {
			expectedBytes: Number(descriptor.size), expectedSha256: String(descriptor.sha256),
		});
		await writer.write(bytes);
		await writer.commitOwned();
	}
}

export async function storedValue(
	database: IDBDatabase,
	storeName: string,
	key: IDBValidKey,
): Promise<unknown> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName]!.get(key)));
}

export function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function archiveAttachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${ARCHIVE_PROXY_SHA}`,
		mimeType: 'video/mp4', byteLength: ARCHIVE_PROXY_BYTES.byteLength,
		sha256: ARCHIVE_PROXY_SHA, originalSha256: ARCHIVE_ORIGINAL_SHA,
		originalAuthorityKind: 'owned', generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'editor-proxy', recipeVersion: 1, timingBackendId: 'ffprobe',
		timingRule: 'exact-presentation-boundaries-v1', frameCount: 10, boundaryCount: 11,
		timingAsset: ARCHIVE_TIMING.reference,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function archiveEntry(
	descriptor: Readonly<Record<string, unknown>>,
	bytes: Uint8Array,
	onRead: (entry: string) => void,
): ScapeArchiveEntry {
	const filename = String(descriptor.entry);
	return {
		filename, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: Number(descriptor.size), uncompressedSize: Number(descriptor.size),
		getData: async (writable) => {
			onRead(filename);
			const writer = writable.getWriter();
			const midpoint = Math.floor(bytes.byteLength / 2);
			try {
				await writer.write(bytes.slice(0, midpoint));
				await writer.write(bytes.slice(midpoint));
				await writer.close();
			} finally { writer.releaseLock(); }
		},
	};
}

function opfsRoot(files: Map<string, Blob>): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string) {
			const file = files.get(path);
			if (!file) throw new Error('missing');
			return { async getFile() { return file; } };
		},
		async removeEntry(path: string) { files.delete(path); },
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

function join(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
