/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, type Hash } from 'node:crypto';
import { EventEmitter, setMaxListeners } from 'node:events';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { createProtocolHandler } from '../desktop/protocol.js';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import type { ScapeProjectInspector } from '../src/common/editor/controller/scape-inspection-service.ts';
import {
	createScapeProjectFileService,
	type ScapeProjectInspection,
} from '../src/common/editor/controller/scape-project-file-service.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import {
	SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
	type ScapeVideoWriter,
} from '../src/common/editor/scape-archive-video.ts';
import type { ScapeImportStore } from '../src/common/editor/scape-import-transaction.ts';
import { importScapeProject, inspectScapeProject } from '../src/common/editor/scape-project.js';
import { withDesktopProjectReadDescriptor } from '../src/common/editor/ui/workspace/desktop-project-file-routing.ts';
import {
	createSparseEightGiBScapeFixture,
	isSparseFixturePlatformError,
	probeSparseFileSupport,
} from './helpers/sparse-scape-zip64-fixture.ts';

const EXACT_ARCHIVE_BYTES = 8 * 1024 ** 3;
const MAXIMUM_PROTOCOL_RANGE_BYTES = 16 * 1024 ** 2;
const ZERO_ASSET_SHA256 = '7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be';
const ZERO_ASSET_CRC32 = 2_909_126_900;

interface ImportedProjectDocument {
	readonly id: string;
	readonly revision?: number;
	readonly [field: string]: unknown;
}

interface PersistedMediaMetadata {
	readonly sourceId: string;
	readonly name: unknown;
	readonly mimeType: unknown;
	readonly size: number;
	readonly sha256: string;
}

type SparseScapeInspection = ScapeProjectInspection & { readonly manifest: ScapeManifest };

class CountingSha256MediaWriter implements ScapeVideoWriter {
	readonly maximumChunkBytes = SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES;
	readonly sourceId: string;
	readonly expectedBytes: number;
	readonly expectedSha256: string;
	readonly #digest: Hash = createHash('sha256');
	readonly #onCommit: (metadata: Readonly<{ size: number; sha256: string }>) => void;
	readonly #onAbort: (committed: boolean) => void;
	#activeWrite = false;
	#committed = false;
	#terminal = false;
	bytesWritten = 0;
	writeCalls = 0;
	commitCalls = 0;
	abortCalls = 0;
	maximumEmissionBytes = 0;
	independentSha256: string | null = null;

	constructor(options: Readonly<{
		sourceId: string;
		expectedBytes: number;
		expectedSha256: string;
		onCommit: (metadata: Readonly<{ size: number; sha256: string }>) => void;
		onAbort: (committed: boolean) => void;
	}>) {
		this.sourceId = options.sourceId;
		this.expectedBytes = options.expectedBytes;
		this.expectedSha256 = options.expectedSha256;
		this.#onCommit = options.onCommit;
		this.#onAbort = options.onAbort;
	}

	async write(bytes: Uint8Array, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
		assert.equal(this.#terminal, false, 'the transactional writer is still active');
		assert.equal(this.#activeWrite, false, 'media writes are awaited serially');
		assert.ok(bytes instanceof Uint8Array, 'the media sink receives byte chunks');
		assert.ok(bytes.byteLength > 0, 'the media sink does not receive empty emissions');
		assert.ok(bytes.byteLength <= this.maximumChunkBytes, 'each media emission is at most 4 MiB');
		assert.ok(bytes.byteLength <= this.expectedBytes - this.bytesWritten, 'the media sink cannot overflow');
		if (options.signal?.aborted) throw options.signal.reason;
		this.#activeWrite = true;
		try {
			await Promise.resolve();
			if (options.signal?.aborted) throw options.signal.reason;
			this.#digest.update(bytes);
			this.bytesWritten += bytes.byteLength;
			this.writeCalls += 1;
			this.maximumEmissionBytes = Math.max(this.maximumEmissionBytes, bytes.byteLength);
		} finally {
			this.#activeWrite = false;
		}
	}

	async commit(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<{
		size: number;
		sha256: string;
	}>> {
		this.commitCalls += 1;
		assert.equal(this.commitCalls, 1, 'the media transaction commits exactly once');
		assert.equal(this.#terminal, false, 'the media transaction is not already terminal');
		assert.equal(this.#activeWrite, false, 'publication waits for the final media write');
		if (options.signal?.aborted) throw options.signal.reason;
		assert.equal(this.bytesWritten, this.expectedBytes, 'the counting sink receives the authentic size');
		this.independentSha256 = this.#digest.digest('hex');
		assert.equal(this.independentSha256, this.expectedSha256, 'the counting sink receives the authentic digest');
		this.#committed = true;
		this.#terminal = true;
		const result = Object.freeze({
			size: this.bytesWritten,
			sha256: this.independentSha256,
		});
		this.#onCommit(result);
		return result;
	}

	async abort(): Promise<void> {
		this.abortCalls += 1;
		assert.equal(this.abortCalls, 1, 'the media writer is cleaned up exactly once');
		this.#terminal = true;
		this.#onAbort(this.#committed);
	}
}

class CountingSha256ImportStore implements ScapeImportStore {
	readonly retainedMediaPayloadBytes = 0;
	readonly events: string[] = [];
	loadProjectCalls = 0;
	listProjectRevisionsCalls = 0;
	beginMediaAssetWriteCalls = 0;
	saveProjectCalls = 0;
	deleteProjectCalls = 0;
	deleteSourceCalls = 0;
	mediaWriter: CountingSha256MediaWriter | null = null;
	publishedProject: ImportedProjectDocument | null = null;
	mediaMetadata: PersistedMediaMetadata | null = null;

	async loadProject(
		projectId: string,
		_options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<ImportedProjectDocument | null> {
		this.loadProjectCalls += 1;
		return this.publishedProject?.id === projectId ? this.publishedProject : null;
	}

	async listProjectRevisions(_projectId: string): Promise<never[]> {
		this.listProjectRevisionsCalls += 1;
		return [];
	}

	async getSourceMetadata(_sourceId: string): Promise<null> {
		return null;
	}

	async getMediaAssetMetadata(sourceId: string): Promise<PersistedMediaMetadata | null> {
		return this.mediaMetadata?.sourceId === sourceId ? this.mediaMetadata : null;
	}

	async beginSourceWrite(): Promise<never> {
		throw new Error('the sparse fixture contains video only');
	}

	async beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			expectedBytes: number;
			expectedSha256: string;
			signal?: AbortSignal;
		}>,
	): Promise<ScapeVideoWriter> {
		this.beginMediaAssetWriteCalls += 1;
		assert.equal(this.beginMediaAssetWriteCalls, 1, 'one video transaction is admitted');
		assert.equal(this.mediaWriter, null);
		if (options.signal?.aborted) throw options.signal.reason;
		this.events.push('media-write-began');
		const writer = new CountingSha256MediaWriter({
			sourceId,
			expectedBytes: options.expectedBytes,
			expectedSha256: options.expectedSha256,
			onCommit: ({ size, sha256 }) => {
				assert.equal(this.mediaMetadata, null, 'immutable media is published once');
				this.mediaMetadata = Object.freeze({
					sourceId,
					name: metadata.name,
					mimeType: metadata.mimeType,
					size,
					sha256,
				});
				this.events.push('media-committed');
			},
			onAbort: (committed) => {
				assert.equal(committed, true, 'successful import cleans the committed writer');
				this.events.push('media-writer-cleaned');
			},
		});
		this.mediaWriter = writer;
		return writer;
	}

	async saveProject(project: ImportedProjectDocument): Promise<void> {
		this.saveProjectCalls += 1;
		assert.equal(this.saveProjectCalls, 1, 'the project is published exactly once');
		assert.ok(this.mediaMetadata, 'the media transaction commits before project publication');
		this.publishedProject = structuredClone(project);
		this.events.push('project-published');
	}

	async deleteProject(): Promise<void> {
		this.deleteProjectCalls += 1;
		this.publishedProject = null;
	}

	async deleteSource(): Promise<void> {
		this.deleteSourceCalls += 1;
		this.mediaMetadata = null;
	}
}

test('an exact 8 GiB sparse desktop Scape fully imports into a counting SHA sink without OPFS or RSS qualification', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-sparse-full-import-'));
	let capabilityStore: ReadCapabilityStore | null = null;
	context.after(async () => {
		const activeStore = capabilityStore;
		if (activeStore) await Promise.resolve(activeStore.dispose()).catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	});

	const probe = await probeSparseFileSupport(root);
	if (!probe.supported) {
		context.skip(`Sparse-file fixture unavailable: ${probe.reason}`);
		return;
	}

	let fixture;
	try {
		fixture = await createSparseEightGiBScapeFixture(join(root, 'exact-eight-gib.scape'));
	} catch (error) {
		if (!isSparseFixturePlatformError(error)) throw error;
		context.skip(`Sparse-file fixture unavailable: ${error.message}`);
		return;
	}
	assert.equal(fixture.logicalSize, EXACT_ARCHIVE_BYTES);
	assert.equal(fixture.assetSha256, ZERO_ASSET_SHA256);
	assert.equal(fixture.assetCrc32, ZERO_ASSET_CRC32);

	const owner = Object.freeze({ name: 'sparse-full-import-renderer' });
	let pinnedHandleCloseCalls = 0;
	const readCapabilities = capabilityStore = new ReadCapabilityStore({
		openImpl: (async (filePath: string, flags: string) => {
			const handle = await open(filePath, flags);
			setMaxListeners(0, handle as unknown as EventEmitter);
			return {
				stat: () => handle.stat(),
				createReadStream: (options: Parameters<typeof handle.createReadStream>[0]) => (
					handle.createReadStream(options)
				),
				close: async () => {
					pinnedHandleCloseCalls += 1;
					await handle.close();
				},
			};
		}) as unknown as typeof open,
	});
	const descriptor = await readCapabilities.registerScapeRangePath(fixture.path, { owner });
	assert.equal(descriptor.size, fixture.logicalSize);

	const protocol = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities,
	});
	const ranges: Array<Readonly<{ start: number; end: number; length: number }>> = [];
	const fetchRange = async (url: string, init: RequestInit = {}): Promise<Response> => {
		assert.equal(url, descriptor.url);
		assert.equal(init.method, 'GET');
		const header = new Headers(init.headers).get('Range');
		const match = /^bytes=(\d+)-(\d+)$/u.exec(header || '');
		assert.ok(match, 'desktop archive reads use one exact byte range');
		const start = Number(match[1]);
		const end = Number(match[2]);
		const length = end - start + 1;
		assert.ok(length > 0 && length <= MAXIMUM_PROTOCOL_RANGE_BYTES);
		assert.ok(start >= 0 && end < fixture.logicalSize);
		const response = await protocol(new Request(url, init));
		assert.equal(response.status, 206);
		assert.equal(response.headers.get('Content-Length'), String(length));
		assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/${fixture.logicalSize}`);
		ranges.push(Object.freeze({ start, end, length }));
		return response;
	};

	let releaseCalls = 0;
	let materializedOpenCalls = 0;
	let importCalls = 0;
	let decisionCalls = 0;
	let rangeSourceWasBlob = true;
	const importStore = new CountingSha256ImportStore();
	const fileService = createAudioEditorFileService({
		bridge: {
			async releaseRead(id: string) {
				releaseCalls += 1;
				assert.equal(id, descriptor.id);
				assert.equal(await readCapabilities.release(id, { owner }), true);
			},
		},
		fetch: fetchRange,
	});
	const projectService = createScapeProjectFileService<SparseScapeInspection, Awaited<
		ReturnType<typeof importScapeProject>
	>>({
		lifetime: new EditorControllerLifetime(),
		store: importStore,
		productCapabilities: {},
		inspectScapeProject: inspectScapeProject as unknown as ScapeProjectInspector<SparseScapeInspection>,
		openScape: async (source, { collision }) => {
			importCalls += 1;
			rangeSourceWasBlob = source instanceof Blob;
			assert.equal(rangeSourceWasBlob, false, 'the range route never materializes a Blob');
			return importScapeProject(source, importStore, { collision });
		},
	});

	const startedAt = performance.now();
	const result = await withDesktopProjectReadDescriptor(fileService, descriptor, {
		openMaterialized: async () => {
			materializedOpenCalls += 1;
			throw new Error('the Scape range route must not materialize the archive');
		},
		openScape: async (source) => projectService.openScapeFile(source, () => {
			decisionCalls += 1;
			throw new Error('a current collision-free Scape import requires no open decision');
		}),
	});
	const durationMs = performance.now() - startedAt;

	const mediaWriter = importStore.mediaWriter;
	assert.ok(mediaWriter);
	assert.equal(result.project.id, fixture.projectId);
	assert.equal(result.collision, null);
	assert.equal(importStore.publishedProject?.id, fixture.projectId);
	assert.deepEqual(importStore.events, [
		'media-write-began',
		'media-committed',
		'media-writer-cleaned',
		'project-published',
	]);
	assert.deepEqual(importStore.mediaMetadata, {
		sourceId: 'video-source',
		name: 'sparse-video.mp4',
		mimeType: 'video/mp4',
		size: fixture.hugePayload.size,
		sha256: fixture.assetSha256,
	});
	assert.equal(mediaWriter.expectedBytes, fixture.hugePayload.size);
	assert.equal(mediaWriter.bytesWritten, fixture.hugePayload.size);
	assert.equal(mediaWriter.expectedSha256, fixture.assetSha256);
	assert.equal(mediaWriter.independentSha256, fixture.assetSha256);
	assert.equal(mediaWriter.maximumEmissionBytes, SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES);
	assert.equal(
		mediaWriter.writeCalls,
		Math.ceil(fixture.hugePayload.size / SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES),
	);
	assert.equal(mediaWriter.commitCalls, 1);
	assert.equal(mediaWriter.abortCalls, 1);
	assert.equal(importStore.retainedMediaPayloadBytes, 0);
	assert.equal(importStore.loadProjectCalls, 3);
	assert.equal(importStore.listProjectRevisionsCalls, 1);
	assert.equal(importStore.beginMediaAssetWriteCalls, 1);
	assert.equal(importStore.saveProjectCalls, 1);
	assert.equal(importStore.deleteProjectCalls, 0);
	assert.equal(importStore.deleteSourceCalls, 0);
	assert.equal(importCalls, 1);
	assert.equal(decisionCalls, 0);
	assert.equal(materializedOpenCalls, 0);
	assert.equal(rangeSourceWasBlob, false);
	assert.equal(releaseCalls, 1);
	assert.equal(pinnedHandleCloseCalls, 1);
	assert.equal(readCapabilities.get(descriptor.id), null);
	assert.ok(ranges.length > mediaWriter.writeCalls);
	assert.ok(ranges.every(({ length }) => length <= MAXIMUM_PROTOCOL_RANGE_BYTES));

	const protocolTransferredBytes = ranges.reduce((total, { length }) => total + length, 0);
	const maximumProtocolRangeBytes = Math.max(...ranges.map(({ length }) => length));
	assert.ok(protocolTransferredBytes >= fixture.hugePayload.size);
	context.diagnostic(JSON.stringify({
		profile: 'exact-8-gib-sparse-full-import-counting-sha256-sink',
		durationMs: Math.round(durationMs),
		archiveLogicalBytes: fixture.logicalSize,
		archivePhysicalAllocationBytes: fixture.allocatedBytes,
		assetBytes: mediaWriter.bytesWritten,
		assetSha256: mediaWriter.independentSha256,
		protocolRangeRequests: ranges.length,
		protocolTransferredBytes,
		maximumProtocolRangeBytes,
		mediaWriteCalls: mediaWriter.writeCalls,
		maximumMediaEmissionBytes: mediaWriter.maximumEmissionBytes,
		retainedMediaPayloadBytes: importStore.retainedMediaPayloadBytes,
		blobMaterializationCalls: materializedOpenCalls,
		sinkKind: 'counting-sha256-no-payload-retention',
		opfsQualified: false,
		processRssQualified: false,
	}));
});
