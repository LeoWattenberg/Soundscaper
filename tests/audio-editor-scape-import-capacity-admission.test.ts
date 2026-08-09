/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';
import type {
	ScapeArchiveEntry,
} from '../src/common/editor/scape-archive-envelope.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES } from '../src/common/editor/scape-archive-video.ts';
import type {
	ScapeImportStore,
} from '../src/common/editor/scape-import-transaction.ts';
import { importScapeProject } from '../src/common/editor/scape-project.js';

const TEXT_ENCODER = new TextEncoder();

interface ImportProjectDocument {
	id: string;
	revision?: number;
	[field: string]: unknown;
}

interface CapacityEstimate {
	readonly usage: number | null;
	readonly quota: number | null;
}

class CapacityProbeStore implements ScapeImportStore {
	readonly events: string[] = [];
	readonly #estimate: () => PromiseLike<CapacityEstimate> | CapacityEstimate;
	#project: ImportProjectDocument | null;

	constructor(options: Readonly<{
		estimate: () => PromiseLike<CapacityEstimate> | CapacityEstimate;
		existingProject?: ImportProjectDocument;
	}>) {
		this.#estimate = options.estimate;
		this.#project = options.existingProject ?? null;
	}

	estimateStorage(): PromiseLike<CapacityEstimate> | CapacityEstimate {
		this.events.push('capacity-estimated');
		return this.#estimate();
	}

	async loadProject(projectId: string): Promise<ImportProjectDocument | null> {
		this.events.push('project-loaded');
		return this.#project?.id === projectId ? structuredClone(this.#project) : null;
	}

	async listProjectRevisions(): Promise<never[]> {
		this.events.push('project-revisions-loaded');
		return [];
	}

	async getSourceMetadata(): Promise<null> {
		this.events.push('source-metadata-read');
		return null;
	}

	async getMediaAssetMetadata(): Promise<null> {
		this.events.push('media-metadata-read');
		return null;
	}

	async beginSourceWrite(): Promise<never> {
		this.events.push('source-write-began');
		throw new Error('The capacity fixture contains video only.');
	}

	async beginMediaAssetWrite(
		_sourceId: string,
		_metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	) {
		this.events.push('media-write-began');
		const events = this.events;
		const state = { bytesWritten: 0 };
		return {
			maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
			get bytesWritten() { return state.bytesWritten; },
			async write(bytes: Uint8Array): Promise<void> {
				events.push('media-bytes-written');
				state.bytesWritten += bytes.byteLength;
			},
			async commit(): Promise<Readonly<Record<string, unknown>>> {
				events.push('media-committed');
				return Object.freeze({
					size: state.bytesWritten,
					sha256: options.expectedSha256,
				});
			},
			async abort(): Promise<void> {
				events.push('media-writer-cleaned');
			},
		};
	}

	async saveProject(project: ImportProjectDocument): Promise<void> {
		this.events.push('project-published');
		this.#project = structuredClone(project);
	}

	async deleteProject(): Promise<void> {
		this.events.push('project-deleted');
		this.#project = null;
	}

	async deleteSource(): Promise<void> {
		this.events.push('source-deleted');
	}
}

test('Scape capacity refusal precedes transaction capture, source remapping, and asset extraction', async () => {
	let assetExtractions = 0;
	const archive = syntheticVideoArchive({
		projectId: 'scape-capacity-refusal',
		assetSize: 100,
		sha256: '0'.repeat(64),
		emit: async () => { assetExtractions += 1; },
	});
	const store = new CapacityProbeStore({
		estimate: () => ({ usage: 891, quota: 1_000 }),
	});

	await assert.rejects(
		importScapeProject(new Blob(['synthetic']), store, {
			archiveReaderFactory: archive.readerFactory,
		}),
		(error: unknown) => error instanceof Error
			&& 'code' in error
			&& error.code === 'QUOTA_EXCEEDED',
	);

	assert.equal(assetExtractions, 0);
	assert.deepEqual(store.events, ['project-loaded', 'capacity-estimated']);
});

test('Scape import admits exact free capacity before opening its media writer', async () => {
	const bytes = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
	const archive = syntheticVideoArchive({
		projectId: 'scape-capacity-exact',
		assetSize: bytes.byteLength,
		sha256: digestScapeBytes(bytes),
		async emit(output) {
			store.events.push('asset-extracted');
			await output.write(bytes);
		},
	});
	const store = new CapacityProbeStore({
		estimate: () => ({ usage: 989, quota: 1_000 }),
	});

	const imported = await importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: archive.readerFactory,
	});

	assert.equal(imported.project.id, 'scape-capacity-exact');
	const capacityIndex = store.events.indexOf('capacity-estimated');
	assert.ok(capacityIndex >= 0);
	assert.ok(capacityIndex < store.events.indexOf('project-revisions-loaded'));
	assert.ok(capacityIndex < store.events.indexOf('media-write-began'));
	assert.ok(store.events.indexOf('media-write-began') < store.events.indexOf('asset-extracted'));
	assert.ok(store.events.indexOf('media-committed') < store.events.indexOf('project-published'));
});

test('Scape import uses one controller estimate before transaction capture, remapping, and extraction', async () => {
	const bytes = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
	const archive = syntheticVideoArchive({
		projectId: 'scape-controller-capacity',
		assetSize: bytes.byteLength,
		sha256: digestScapeBytes(bytes),
		async emit(output) {
			store.events.push('asset-extracted');
			await output.write(bytes);
		},
	});
	const store = new CapacityProbeStore({
		estimate: () => { throw new Error('The store estimator must not run.'); },
	});
	const preflights: Array<readonly [number, 'import']> = [];

	const imported = await importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: archive.readerFactory,
		estimateStorageForPreflight(assetBytes: number, operation: 'import') {
			preflights.push([assetBytes, operation]);
			store.events.push('controller-capacity-estimated');
			return { usage: 989, quota: 1_000 };
		},
	});

	assert.equal(imported.project.id, 'scape-controller-capacity');
	assert.deepEqual(preflights, [[10, 'import']]);
	assert.equal(store.events.includes('capacity-estimated'), false);
	const capacityIndex = store.events.indexOf('controller-capacity-estimated');
	assert.ok(store.events.indexOf('project-loaded') < capacityIndex);
	assert.ok(capacityIndex < store.events.indexOf('project-revisions-loaded'));
	assert.ok(capacityIndex < store.events.indexOf('media-metadata-read'));
	assert.ok(capacityIndex < store.events.indexOf('media-write-began'));
	assert.ok(capacityIndex < store.events.indexOf('asset-extracted'));
	assert.ok(store.events.indexOf('media-committed') < store.events.indexOf('project-published'));
});

test('collision cancellation takes precedence and does not request a storage estimate', async () => {
	let assetExtractions = 0;
	let controllerEstimatorCalls = 0;
	const projectId = 'scape-capacity-collision-cancel';
	const archive = syntheticVideoArchive({
		projectId,
		assetSize: 100,
		sha256: '0'.repeat(64),
		emit: async () => { assetExtractions += 1; },
	});
	const store = new CapacityProbeStore({
		estimate: () => { throw new Error('capacity must not be estimated'); },
		existingProject: { id: projectId, revision: 4 },
	});

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		collision: 'cancel',
		archiveReaderFactory: archive.readerFactory,
		estimateStorageForPreflight() {
			controllerEstimatorCalls += 1;
			throw new Error('Controller capacity must not be estimated.');
		},
	}), /project with this ID already exists/iu);

	assert.equal(assetExtractions, 0);
	assert.equal(controllerEstimatorCalls, 0);
	assert.deepEqual(store.events, ['project-loaded']);
});

test('copy and replace imports each charge the full incoming asset size', async (context) => {
	for (const collision of ['copy', 'replace'] as const) {
		await context.test(collision, async () => {
			let assetExtractions = 0;
			const projectId = `scape-capacity-${collision}`;
			const archive = syntheticVideoArchive({
				projectId,
				assetSize: 100,
				sha256: '0'.repeat(64),
				emit: async () => { assetExtractions += 1; },
			});
			const store = new CapacityProbeStore({
				estimate: () => ({ usage: 891, quota: 1_000 }),
				existingProject: { id: projectId, revision: 4 },
			});

			await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
				collision,
				archiveReaderFactory: archive.readerFactory,
			}), (error: unknown) => error instanceof Error
				&& 'code' in error
				&& error.code === 'QUOTA_EXCEEDED');

			assert.equal(assetExtractions, 0);
			assert.deepEqual(store.events, ['project-loaded', 'capacity-estimated']);
		});
	}
});

test('cancellation abandons a signal-ignoring storage estimate before asset extraction', async () => {
	let resolveEstimate: ((value: CapacityEstimate) => void) | undefined;
	let markEstimateStarted: (() => void) | undefined;
	const estimateStarted = new Promise<void>((resolve) => { markEstimateStarted = resolve; });
	const estimate = new Promise<CapacityEstimate>((resolve) => { resolveEstimate = resolve; });
	let assetExtractions = 0;
	let readerCloseCalls = 0;
	const archive = syntheticVideoArchive({
		projectId: 'scape-capacity-cancelled',
		assetSize: 100,
		sha256: '0'.repeat(64),
		emit: async () => { assetExtractions += 1; },
		onClose: () => { readerCloseCalls += 1; },
	});
	const store = new CapacityProbeStore({
		estimate: () => {
			markEstimateStarted?.();
			return estimate;
		},
	});
	const controller = new AbortController();
	const reason = new DOMException('cancel capacity estimate', 'AbortError');
	const importing = importScapeProject(new Blob(['synthetic']), store, {
		signal: controller.signal,
		archiveReaderFactory: archive.readerFactory,
	});

	await estimateStarted;
	controller.abort(reason);
	await assert.rejects(importing, (error) => error === reason);
	assert.equal(assetExtractions, 0);
	assert.equal(readerCloseCalls, 1);
	assert.deepEqual(store.events, ['project-loaded', 'capacity-estimated']);

	resolveEstimate?.({ usage: 0, quota: 1_000 });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(assetExtractions, 0);
	assert.deepEqual(store.events, ['project-loaded', 'capacity-estimated']);
});

function syntheticVideoArchive(options: Readonly<{
	projectId: string;
	assetSize: number;
	sha256: string;
	emit(output: WritableStreamDefaultWriter<Uint8Array>): Promise<void>;
	onClose?: () => void;
}>) {
	const project = videoProject(options.projectId);
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const assetEntry = 'media/video-source/original';
	const manifestBytes = TEXT_ENCODER.encode(JSON.stringify({
		format: 'scape-project',
		formatVersion: 1,
		project: {
			entry: 'project.json',
			size: projectBytes.byteLength,
			sha256: digestScapeBytes(projectBytes),
		},
		assets: [{
			sourceId: 'video-source',
			kind: 'video',
			entry: assetEntry,
			encoding: 'original',
			mimeType: 'video/mp4',
			size: options.assetSize,
			sha256: options.sha256,
		}],
	}));
	const entries: ScapeArchiveEntry[] = [
		byteEntry('manifest.json', manifestBytes),
		byteEntry('project.json', projectBytes),
		{
			filename: assetEntry,
			directory: false,
			encrypted: false,
			compressionMethod: 0,
			compressedSize: options.assetSize,
			uncompressedSize: options.assetSize,
			async getData(writable, readOptions) {
				if (readOptions?.checkOverlappingEntryOnly) return;
				const output = writable.getWriter();
				await options.emit(output);
				await output.close();
			},
		},
	];
	return {
		readerFactory: () => ({
			async *getEntriesGenerator() {
				for (const entry of entries) yield entry;
				return false;
			},
			close: async () => { options.onClose?.(); },
		}),
	};
}

function byteEntry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return {
		filename,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: bytes.byteLength,
		uncompressedSize: bytes.byteLength,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const output = writable.getWriter();
			await output.write(bytes);
			await output.close();
		},
	};
}

function videoProject(id: string) {
	return createAudioEditorProjectV10({
		id,
		title: 'Capacity admission',
		sources: [{
			kind: 'video',
			id: 'video-source',
			storageKey: 'video-source',
			name: 'picture.mp4',
			mimeType: 'video/mp4',
			frameCount: 48_000,
			sampleRate: 48_000,
			width: 1_920,
			height: 1_080,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: null,
			hasAudio: false,
		}],
		clips: [{
			kind: 'video',
			id: 'video-clip',
			sourceId: 'video-source',
			title: 'Picture',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
		}],
		tracks: [{ type: 'video', id: 'video-track', name: 'Video', clipIds: ['video-clip'] }],
	});
}
