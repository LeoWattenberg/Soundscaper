/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV6 } from '../src/common/editor/project-v6.ts';
import {
	extractScapeVideo,
	SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
} from '../src/common/editor/scape-archive-video.ts';
import { withScapeArchiveReader } from '../src/common/editor/scape-archive-reader.ts';
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';

test('pre-aborted import and inspection stop before metadata or storage work', async () => {
	const sourceStore = memoryStore('scape-pre-abort-source');
	const targetStore = memoryStore('scape-pre-abort-target');
	const project = audioProject();
	await persistAudio(sourceStore);
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const before = await inventory(targetStore);
	const controller = new AbortController();
	controller.abort(abortReason('cancel before metadata'));

	await assertAbort(importScapeProject(archive, targetStore, { signal: controller.signal }));
	await assertAbort(inspectScapeProject(archive, targetStore, { signal: controller.signal }));
	assert.deepEqual(await inventory(targetStore), before);
});

test('imports reject an incomplete transactional store before their first mutation', async () => {
	const sourceStore = memoryStore('scape-incomplete-store-source');
	const project = audioProject('scape-incomplete-store');
	await persistAudio(sourceStore);
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	let storageWrites = 0;
	const incompleteStore = {
		loadProject: async () => null,
		listProjectRevisions: async () => [],
		getMediaAssetMetadata: async () => null,
		// getSourceMetadata is deliberately absent.
		beginSourceWrite: async () => { storageWrites += 1; throw new Error('unexpected write'); },
		beginMediaAssetWrite: async () => { storageWrites += 1; throw new Error('unexpected write'); },
		saveProject: async () => { storageWrites += 1; },
		deleteProject: async () => { storageWrites += 1; },
		deleteSource: async () => { storageWrites += 1; },
	};

	await assert.rejects(
		importScapeProject(archive, incompleteStore),
		/transactional project store/iu,
	);
	assert.equal(storageWrites, 0);
});

test('archive readers close when cancellation arrives after central-directory parsing', async () => {
	const controller = new AbortController();
	let closeCalls = 0;
	let actionCalls = 0;
	let readerSignal: AbortSignal | undefined;

	await assertAbort(withScapeArchiveReader(
		new Blob(['archive']),
		controller.signal,
		async () => {
			actionCalls += 1;
			controller.abort(abortReason('cancel after entries'));
			return 'unreachable';
		},
		(_input, signal) => {
			readerSignal = signal;
			return {
			getEntriesGenerator: async function* () { return false; },
			close: async () => { closeCalls += 1; },
			};
		},
	));
	assert.equal(actionCalls, 1);
	assert.equal(closeCalls, 1);
	assert.equal(readerSignal, controller.signal);
});

test('video extraction passes its signal into ZIP work and stops between emitted chunks', async () => {
	const controller = new AbortController();
	let entrySignal: AbortSignal | undefined;
	let writes = 0;
	const entry = {
		filename: 'media/video/original',
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: 2,
		uncompressedSize: 2,
		async getData(writable: WritableStream<Uint8Array>, options?: { signal?: AbortSignal }) {
			entrySignal = options?.signal;
			const writer = writable.getWriter();
			await writer.write(Uint8Array.of(1));
			writes += 1;
			controller.abort(abortReason('cancel video extraction'));
			await writer.write(Uint8Array.of(2));
			await writer.close();
		},
	};

	await assertAbort(extractScapeVideo(entry, {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		bytesWritten: 0,
		write: async () => undefined,
		commit: async () => ({}),
		abort: async () => undefined,
	}, controller.signal));
	assert.equal(entrySignal, controller.signal);
	assert.equal(writes, 1);
});

test('cancellation as an audio writer is acquired aborts it before the first write', async () => {
	const sourceStore = memoryStore('scape-audio-acquire-abort-source');
	const backingStore = memoryStore('scape-audio-acquire-abort-target');
	const project = audioProject('scape-audio-acquire-abort');
	await persistAudio(sourceStore);
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const before = await inventory(backingStore);
	const controller = new AbortController();
	let writes = 0;
	let aborts = 0;
	const targetStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'beginSourceWrite') return async (...args: Parameters<typeof target.beginSourceWrite>) => {
				const writer = await target.beginSourceWrite(...args);
				controller.abort(abortReason('cancel while acquiring audio writer'));
				return {
					get framesWritten() { return writer.framesWritten; },
					async write(channels: readonly Float32Array[], options?: { signal?: AbortSignal }) {
						writes += 1;
						await writer.write(channels, options);
					},
					commit: writer.commit.bind(writer),
					async abort() { aborts += 1; await writer.abort(); },
				};
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assertAbort(importScapeProject(archive, targetStore, { signal: controller.signal }));
	assert.equal(writes, 0);
	assert.equal(aborts, 1);
	assert.deepEqual(await inventory(backingStore), before);
});

test('cancellation during the first audio write aborts staging and preserves inventory', async () => {
	const sourceStore = memoryStore('scape-audio-abort-source');
	const backingStore = memoryStore('scape-audio-abort-target');
	const project = audioProject();
	await persistAudio(sourceStore);
	await seedPreviousProject(backingStore, project.id);
	await persistAudio(backingStore);
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const before = await inventory(backingStore);
	const controller = new AbortController();
	let writes = 0;
	let aborts = 0;
	let commits = 0;
	let writerSignal: AbortSignal | undefined;
	const targetStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'beginSourceWrite') return async (...args: Parameters<typeof target.beginSourceWrite>) => {
				const writer = await target.beginSourceWrite(...args);
				return {
					get framesWritten() { return writer.framesWritten; },
					async write(channels: readonly Float32Array[], options?: { signal?: AbortSignal }) {
						writes += 1;
						writerSignal = options?.signal;
						await writer.write(channels, options);
						controller.abort(abortReason('cancel during audio write'));
					},
					async commit(metadata?: Record<string, unknown>) {
						commits += 1;
						return writer.commit(metadata);
					},
					async abort() {
						aborts += 1;
						await writer.abort();
					},
				};
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assertAbort(importScapeProject(archive, targetStore, {
		collision: 'replace',
		signal: controller.signal,
	}));
	assert.equal(writes, 1);
	assert.equal(commits, 0);
	assert.equal(aborts, 1);
	assert.equal(writerSignal, controller.signal);
	assert.deepEqual(await inventory(backingStore), before);
});

test('cancellation as a video writer is acquired aborts staging before extraction', async () => {
	const sourceStore = memoryStore('scape-video-acquire-abort-source');
	const backingStore = memoryStore('scape-video-acquire-abort-target');
	const project = videoProject('scape-video-acquire-abort');
	await persistVideo(sourceStore);
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const before = await inventory(backingStore);
	const controller = new AbortController();
	let writes = 0;
	let commits = 0;
	let aborts = 0;
	const targetStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'beginMediaAssetWrite') return async (
				...args: Parameters<typeof target.beginMediaAssetWrite>
			) => {
				const writer = await target.beginMediaAssetWrite(...args);
				controller.abort(abortReason('cancel while acquiring video writer'));
				return {
					maximumChunkBytes: writer.maximumChunkBytes,
					get bytesWritten() { return writer.bytesWritten; },
					async write(bytes: Uint8Array, options?: { signal?: AbortSignal }) {
						writes += 1;
						await writer.write(bytes, options);
					},
					async commit(...commitArgs: Parameters<typeof writer.commit>) {
						commits += 1;
						return writer.commit(...commitArgs);
					},
					async abort() { aborts += 1; await writer.abort(); },
				};
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assertAbort(importScapeProject(archive, targetStore, { signal: controller.signal }));
	assert.equal(writes, 0);
	assert.equal(commits, 0);
	assert.equal(aborts, 1);
	assert.deepEqual(await inventory(backingStore), before);
});

test('cancellation during video publication deletes the provisional asset and preserves inventory', async () => {
	const sourceStore = memoryStore('scape-video-abort-source');
	const backingStore = memoryStore('scape-video-abort-target');
	const project = videoProject();
	await persistVideo(sourceStore);
	await seedPreviousProject(backingStore, project.id);
	await persistVideo(backingStore);
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const before = await inventory(backingStore);
	const controller = new AbortController();
	let mediaWrites = 0;
	let mediaWriteSignal: AbortSignal | undefined;
	const targetStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'beginMediaAssetWrite') return async (
				...args: Parameters<typeof target.beginMediaAssetWrite>
			) => {
				const publicationOptions = args[2] as Readonly<{ signal?: AbortSignal }> | undefined;
				mediaWriteSignal = publicationOptions?.signal;
				const writer = await target.beginMediaAssetWrite(...args);
				return {
					maximumChunkBytes: writer.maximumChunkBytes,
					get bytesWritten() { return writer.bytesWritten; },
					write: writer.write.bind(writer),
					async commit(...commitArgs: Parameters<typeof writer.commit>) {
						mediaWrites += 1;
						const result = await writer.commit(...commitArgs);
						controller.abort(abortReason('cancel during video write'));
						return result;
					},
					abort: writer.abort.bind(writer),
				};
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assertAbort(importScapeProject(archive, targetStore, {
		collision: 'replace',
		signal: controller.signal,
	}));
	assert.equal(mediaWrites, 1);
	assert.equal(mediaWriteSignal, controller.signal);
	assert.deepEqual(await inventory(backingStore), before);
});

test('late cancellation after project save restores the previous committed project', async () => {
	const sourceStore = memoryStore('scape-project-abort-source');
	const backingStore = memoryStore('scape-project-abort-target');
	const replacement = projectOnly('scape-project-publication', 'Replacement');
	const previousRevision = { ...projectOnly(replacement.id, 'Earlier'), revision: 1 };
	const previous = { ...projectOnly(replacement.id, 'Previous'), revision: 2 };
	await backingStore.saveProject(previousRevision);
	await backingStore.saveProject(previous);
	const archive = (await exportScapeProject(replacement, sourceStore)).blob as Blob;
	const before = await inventory(backingStore);
	const controller = new AbortController();
	let replacementWrites = 0;
	const targetStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'saveProject') return async (project: Readonly<{ title?: string }>) => {
				const result = await target.saveProject(project);
				if (project.title === replacement.title) {
					replacementWrites += 1;
					controller.abort(abortReason('cancel after project publication'));
				}
				return result;
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assertAbort(importScapeProject(archive, targetStore, {
		collision: 'replace',
		signal: controller.signal,
	}));
	assert.equal(replacementWrites, 1);
	assert.deepEqual(await inventory(backingStore), before);
});

test('cancellation during export returns the source iterator and aborts the destination', async () => {
	const backingStore = memoryStore('scape-export-abort-source');
	const project = audioProject('scape-export-abort');
	await persistAudio(backingStore);
	await backingStore.saveProject(project);
	const before = await inventory(backingStore);
	const controller = new AbortController();
	let iteratorReturns = 0;
	let sourceReadSignal: AbortSignal | undefined;
	const sourceStore = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'readSourceChunks') return (sourceId: string, options?: { signal?: AbortSignal }) => (async function* () {
				sourceReadSignal = options?.signal;
				try {
					for await (const chunk of target.readSourceChunks(sourceId, options)) {
						controller.abort(abortReason('cancel during export'));
						yield chunk;
					}
				} finally {
					iteratorReturns += 1;
				}
			})();
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	let destinationWrites = 0;
	let destinationCloses = 0;
	let destinationAborts = 0;
	const destination = new WritableStream<Uint8Array>({
		write() { destinationWrites += 1; },
		close() { destinationCloses += 1; },
		abort() { destinationAborts += 1; },
	});

	await assertAbort(exportScapeProject(project, sourceStore, {
		signal: controller.signal,
		writable: destination,
	}));
	assert.ok(destinationWrites > 0);
	assert.equal(destinationCloses, 0);
	assert.equal(destinationAborts, 1);
	assert.equal(iteratorReturns, 1);
	assert.equal(sourceReadSignal, controller.signal);
	assert.deepEqual(await inventory(backingStore), before);
});

test('a successful streamed export closes and publishes its destination exactly once', async () => {
	const store = memoryStore('scape-stream-export-success');
	const project = projectOnly('scape-stream-export-success', 'Streamed');
	const chunks: ArrayBuffer[] = [];
	let closes = 0;
	let aborts = 0;
	const destination = new WritableStream<Uint8Array>({
		write(chunk) {
			const copy = new Uint8Array(chunk.byteLength);
			copy.set(chunk);
			chunks.push(copy.buffer);
		},
		close() { closes += 1; },
		abort() { aborts += 1; },
	});

	const exported = await exportScapeProject(project, store, { writable: destination });
	assert.equal(exported.blob, null);
	assert.equal(closes, 1);
	assert.equal(aborts, 0);
	const archive = new Blob(chunks, { type: 'application/vnd.soundscaper.scape+zip' });
	const inspected = await inspectScapeProject(archive);
	assert.equal(inspected.id, project.id);
});

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		databaseName: `${prefix}-${String(Date.now())}-${String(Math.random())}`,
	});
}

async function persistAudio(store: ReturnType<typeof memoryStore>): Promise<void> {
	const writer = await store.beginSourceWrite('audio-source', {
		name: 'sound.wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 2,
	});
	await writer.write([Float32Array.of(0.25, -0.25)]);
	await writer.write([Float32Array.of(0.5, -0.5)]);
	await writer.commit({ sampleRate: 48_000, channelCount: 1, chunkFrames: 2 });
}

async function persistVideo(store: ReturnType<typeof memoryStore>): Promise<void> {
	await store.writeMediaAsset('video-source', new Blob(['video-payload'], { type: 'video/mp4' }), {
		name: 'picture.mp4',
		mimeType: 'video/mp4',
	});
}

async function seedPreviousProject(store: ReturnType<typeof memoryStore>, id: string): Promise<void> {
	await store.saveProject(projectOnly(id, 'Previous'));
}

function audioProject(id = 'scape-cancel-project') {
	return createAudioEditorProjectV6({
		id,
		title: 'Incoming audio',
		sources: [{
			kind: 'audio',
			id: 'audio-source',
			storageKey: 'audio-source',
			name: 'sound.wav',
			mimeType: 'audio/wav',
			frameCount: 4,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			chunkFrames: 2,
		}],
		clips: [{
			kind: 'audio',
			id: 'audio-clip',
			sourceId: 'audio-source',
			title: 'Sound',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 4,
			durationFrames: 4,
		}],
		tracks: [{ type: 'audio', id: 'audio-track', name: 'Audio', clipIds: ['audio-clip'] }],
	});
}

function videoProject(id = 'scape-cancel-project') {
	return createAudioEditorProjectV6({
		id,
		title: 'Incoming video',
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

function projectOnly(id: string, title: string) {
	return createAudioEditorProjectV6({ id, title, sources: [], clips: [], tracks: [] });
}

async function inventory(store: ReturnType<typeof memoryStore>) {
	const projects = await store.listProjects();
	const revisions = Object.fromEntries(await Promise.all(projects.map(async ({ id }) => [
		id,
		await store.listProjectRevisions(id),
	])));
	const sources = await store.listSources();
	const media = [...store.memory.mediaAssets.entries()]
		.map(([id, value]) => {
			const record = value as Readonly<{ name?: unknown; size?: unknown; mimeType?: unknown }>;
			return {
				id,
				name: record.name,
				size: record.size,
				mimeType: record.mimeType,
			};
		})
		.sort((left, right) => left.id.localeCompare(right.id));
	return { projects, revisions, sources, media };
}

function abortReason(message: string): DOMException {
	return new DOMException(message, 'AbortError');
}

async function assertAbort(value: PromiseLike<unknown>): Promise<void> {
	await assert.rejects(Promise.resolve(value), (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));
}
