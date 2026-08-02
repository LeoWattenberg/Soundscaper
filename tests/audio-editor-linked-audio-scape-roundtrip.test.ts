/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobReader,
	TextWriter,
	Uint8ArrayWriter,
	ZipReader,
} from '@zip.js/zip.js';

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const LOCATOR_ID = 'locator_scape_audio_000001';
const LOCATOR_REVISION = 'snapshot_scape_audio_000001';
const SOURCE_ID = 'linked-scape-audio-source';
const STORAGE_KEY = 'linked-scape-audio-storage';
const SAMPLES = [-1, -0.5, 0.25, 0.75, 1] as const;

type ProjectStore = ReturnType<typeof createProjectStore>;

interface ArchiveEntry {
	readonly filename: string;
	getData(writer: TextWriter): Promise<string>;
	getData(writer: Uint8ArrayWriter): Promise<Uint8Array>;
}

test('portable Scape export turns a linked WAV into durable recipient-owned canonical PCM', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const senderDatabaseName = `linked-scape-sender-${String(Date.now())}-${String(Math.random())}`;
	const recipientDatabaseName = `linked-scape-recipient-${String(Date.now())}-${String(Math.random())}`;
	const externalWavBytes = floatRiffWav(SAMPLES);
	const externalWav = new Blob([exactArrayBuffer(externalWavBytes)], { type: 'audio/wav' });
	const canonicalBytes = canonicalPcmChunk(SAMPLES);
	const port: LinkedOriginalPort = {
		load(kind, locatorId, { expectedRevision }) {
			assert.equal(kind, 'audio');
			assert.equal(locatorId, LOCATOR_ID);
			if (expectedRevision !== null && expectedRevision !== LOCATOR_REVISION) return null;
			return { blob: externalWav, locatorRevision: LOCATOR_REVISION };
		},
	};
	const stores = new Set<ProjectStore>();
	context.after(async () => {
		await Promise.all([...stores].map(async (store) => { await store.close(); }));
	});
	const sender = trackStore(stores, createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: senderDatabaseName,
		linkedOriginalPort: port,
	}));
	await sender.ready();
	const source = createAudioSourceV9({
		id: SOURCE_ID,
		storageKey: STORAGE_KEY,
		name: 'Linked portable audio.wav',
		mimeType: 'audio/wav',
		frameCount: SAMPLES.length,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: SAMPLES.length,
	});
	const clip = createAudioClipV9({
		id: 'linked-scape-audio-clip',
		sourceId: source.id,
		durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount,
	});
	const track = createAudioTrackV9({
		id: 'linked-scape-audio-track',
		name: 'Linked portable audio',
		clipIds: [clip.id],
	});
	const project = createAudioEditorProjectV9({
		id: 'linked-scape-portable-project',
		title: 'Linked Scape portability',
		now: '2026-08-02T10:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});

	await sender.bindLinkedAudioOriginal(project.id, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: externalWav,
	});
	await sender.saveProject(project, { protectedLinkedVideoSourceIds: [] });
	assert.deepEqual(await sender.listSources(), []);
	assert.equal(indexedDB.recordCount(senderDatabaseName, 'sources'), 0);
	assert.equal(indexedDB.recordCount(senderDatabaseName, 'sourceChunks'), 0);

	const exported = await exportScapeProject(project, sender);
	assert.ok(exported.blob instanceof Blob);
	assert.equal(exported.manifest.assets.length, 1);
	const descriptor = exported.manifest.assets[0];
	assert.ok(descriptor);
	assert.equal(descriptor.kind, 'audio');
	assert.equal(descriptor.encoding, 'audio-f32le-chunks-v1');
	assert.equal(descriptor.size, canonicalBytes.byteLength);
	assert.notEqual(descriptor.size, externalWavBytes.byteLength);
	if (typeof descriptor.entry !== 'string') throw new TypeError('Expected a Scape audio entry name.');

	const archive = await readPortableArchive(exported.blob, descriptor.entry);
	assert.deepEqual(archive.audioBytes, canonicalBytes);
	assert.deepEqual(archive.entryNames.sort(), [
		'audio/linked-scape-audio-source.f32c',
		'manifest.json',
		'project.json',
	]);
	assert.deepEqual(JSON.parse(archive.projectText), project);
	for (const secret of [LOCATOR_ID, LOCATOR_REVISION]) {
		assert.equal(archive.projectText.includes(secret), false);
		assert.equal(archive.manifestText.includes(secret), false);
		assert.equal(containsBytes(archive.archiveBytes, new TextEncoder().encode(secret)), false);
	}
	assert.equal(containsBytes(archive.archiveBytes, externalWavBytes), false);
	await sender.close();

	const recipient = trackStore(stores, createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: recipientDatabaseName,
	}));
	await recipient.ready();
	const imported = await importScapeProject(exported.blob, recipient) as {
		readonly project: AudioEditorProjectV9;
	};
	const importedSource = imported.project.sources.find(({ kind }) => kind === 'audio');
	assert.ok(importedSource);
	assert.equal(importedSource.id, SOURCE_ID);
	assert.equal(importedSource.storageKey, SOURCE_ID);
	assert.equal(await recipient.getLinkedOriginalBinding(imported.project.id, importedSource.id), null);
	assert.equal((await recipient.getSourceMetadata(importedSource.storageKey))?.storage, 'indexeddb-chunks');
	assert.deepEqual(await readMonoSamples(recipient, importedSource.storageKey), SAMPLES);
	assert.equal(indexedDB.recordCount(recipientDatabaseName, 'sources'), 1);
	assert.equal(indexedDB.recordCount(recipientDatabaseName, 'sourceChunks'), 1);
	assert.equal(indexedDB.recordCount(recipientDatabaseName, 'linkedVideoOriginalBindings'), 0);
	await recipient.close();

	const reopened = trackStore(stores, createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: recipientDatabaseName,
	}));
	await reopened.ready();
	const reopenedValue = await reopened.loadProject(imported.project.id);
	assert.ok(reopenedValue);
	const reopenedProject = reopenedValue as unknown as AudioEditorProjectV9;
	const reopenedSource = reopenedProject.sources.find(({ kind }) => kind === 'audio');
	assert.ok(reopenedSource);
	assert.equal(reopenedSource.storageKey, SOURCE_ID);
	assert.equal(await reopened.getLinkedOriginalBinding(reopenedProject.id, reopenedSource.id), null);
	assert.equal((await reopened.getSourceMetadata(reopenedSource.storageKey))?.storage, 'indexeddb-chunks');
	assert.deepEqual(await readMonoSamples(reopened, reopenedSource.storageKey), SAMPLES);
});

function trackStore(stores: Set<ProjectStore>, store: ProjectStore): ProjectStore {
	stores.add(store);
	return store;
}

function floatRiffWav(samples: readonly number[]): Uint8Array {
	const encoded = encodeWav([Float32Array.from(samples)], {
		float: true,
		dither: false,
		sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
	return bytes;
}

function canonicalPcmChunk(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, samples.length, true);
	for (const [index, sample] of samples.entries()) {
		view.setFloat32(4 + index * Float32Array.BYTES_PER_ELEMENT, sample, true);
	}
	return bytes;
}

async function readPortableArchive(blob: Blob, audioEntryName: string): Promise<Readonly<{
	archiveBytes: Uint8Array;
	audioBytes: Uint8Array;
	entryNames: string[];
	manifestText: string;
	projectText: string;
}>> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	try {
		const entries = await reader.getEntries();
		const project = requiredArchiveEntry(entries, 'project.json');
		const manifest = requiredArchiveEntry(entries, 'manifest.json');
		const audio = requiredArchiveEntry(entries, audioEntryName);
		return Object.freeze({
			archiveBytes: new Uint8Array(await blob.arrayBuffer()),
			audioBytes: await audio.getData(new Uint8ArrayWriter()),
			entryNames: entries.map(({ filename }) => filename),
			manifestText: await manifest.getData(new TextWriter()),
			projectText: await project.getData(new TextWriter()),
		});
	} finally {
		await reader.close();
	}
}

function requiredArchiveEntry(entries: readonly unknown[], filename: string): ArchiveEntry {
	const entry = entries.find((candidate) => typeof candidate === 'object'
		&& candidate !== null
		&& Reflect.get(candidate, 'filename') === filename);
	if (typeof entry !== 'object' || entry === null
		|| typeof Reflect.get(entry, 'getData') !== 'function') {
		throw new Error(`The Scape archive is missing ${filename}.`);
	}
	return entry as ArchiveEntry;
}

async function readMonoSamples(store: ProjectStore, storageKey: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const chunk of store.readSourceChunks(storageKey)) {
		assert.equal(chunk.channels.length, 1);
		samples.push(...chunk.channels[0]);
	}
	return samples;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
	outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
		for (let index = 0; index < needle.byteLength; index += 1) {
			if (haystack[offset + index] !== needle[index]) continue outer;
		}
		return true;
	}
	return false;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}
