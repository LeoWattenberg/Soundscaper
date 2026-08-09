/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryAudioMediaBinding,
	createDesktopLibraryVideoMediaBinding,
	createDesktopLibraryVideoTimingBinding,
	DesktopLibraryManagedMediaStore,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING,
	type DesktopLibraryMediaCatalogPort,
} from '../desktop/project-library-media.ts';
import {
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
} from '../desktop/project-library-contract.ts';
import {
	TestDesktopLibraryManagedMediaInventoryPort,
} from './helpers/desktop-project-library-media-inventory-port.ts';

const PROJECT_ID = 'managed-video-project';
const PROJECT_REVISION = 7;
const PROJECT_SHA256 = 'a'.repeat(64);
const STORAGE_KEY = 'managed-video-storage';

test('original video has a revision-bound namespace distinct from canonical audio', () => {
	const audio = createDesktopLibraryAudioMediaBinding(
		PROJECT_ID, STORAGE_KEY, PROJECT_REVISION, PROJECT_SHA256,
	);
	const video = createDesktopLibraryVideoMediaBinding(
		PROJECT_ID, STORAGE_KEY, PROJECT_REVISION, PROJECT_SHA256,
	);
	const timing = createDesktopLibraryVideoTimingBinding(
		PROJECT_ID, STORAGE_KEY, PROJECT_REVISION, PROJECT_SHA256,
	);

	assert.match(audio.id, /^m[a-f0-9]{64}$/u);
	assert.match(audio.relativeFile, /^audio\/[a-f0-9]{2}\/m[a-f0-9]{64}\.f32c$/u);
	assert.match(video.id, /^v[a-f0-9]{64}$/u);
	assert.match(video.relativeFile, /^video\/[a-f0-9]{2}\/v[a-f0-9]{64}\.bin$/u);
	assert.match(timing.id, /^t[a-f0-9]{64}$/u);
	assert.match(timing.relativeFile, /^timing\/[a-f0-9]{2}\/t[a-f0-9]{64}\.scti$/u);
	assert.notEqual(video.id.slice(1), audio.id.slice(1));
	assert.notEqual(timing.id.slice(1), video.id.slice(1));
	assert.notEqual(
		createDesktopLibraryVideoMediaBinding(
			PROJECT_ID, STORAGE_KEY, PROJECT_REVISION + 1, PROJECT_SHA256,
		).id,
		video.id,
	);
	assert.notEqual(
		createDesktopLibraryVideoMediaBinding(
			PROJECT_ID, STORAGE_KEY, PROJECT_REVISION, 'b'.repeat(64),
		).id,
		video.id,
	);
});

test('video timing assets publish through their digest-bound managed namespace', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(0x53, 0x43, 0x54, 0x49, 1, 0, 0, 0);
	const binding = createDesktopLibraryVideoTimingBinding(
		PROJECT_ID, STORAGE_KEY, PROJECT_REVISION, PROJECT_SHA256,
	);
	const descriptor = await fixture.store.publish({
		encoding: DESKTOP_LIBRARY_VIDEO_TIMING_ENCODING,
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		projectSha256: PROJECT_SHA256,
		storageKey: STORAGE_KEY,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
		chunks: chunks(bytes.subarray(0, 3), bytes.subarray(3, 6), bytes.subarray(6)),
	});
	assert.deepEqual(descriptor, { ...binding, byteLength: bytes.byteLength, sha256: digest(bytes) });
	assert.deepEqual(joinBytes([
		await fixture.store.read(binding.id, { offset: 0, length: 4 }),
		await fixture.store.read(binding.id, { offset: 4, length: 4 }),
	]), bytes);
});

test('original video is materialized before catalog publication and supports bounded reads', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(0, 1, 2, 3, 4, 5, 6);
	const binding = createDesktopLibraryVideoMediaBinding(
		PROJECT_ID, STORAGE_KEY, PROJECT_REVISION, PROJECT_SHA256,
	);
	fixture.onPublish = async (metadata) => {
		const path = join(fixture.root, ...binding.relativeFile.split('/'));
		assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
		return metadata;
	};

	const descriptor = await fixture.store.publish({
		encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		projectSha256: PROJECT_SHA256,
		storageKey: STORAGE_KEY,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
		chunks: chunks(bytes.subarray(0, 3), bytes.subarray(3)),
	});

	assert.deepEqual(descriptor, {
		id: binding.id,
		relativeFile: binding.relativeFile,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
	});
	assert.deepEqual(fixture.metadata.media, [descriptor]);
	assert.deepEqual(await fixture.store.read(binding.id, { offset: 2, length: 4 }), bytes.subarray(2, 6));
});

test('video and audio publications sharing a storage key cannot alias bodies', async (context) => {
	const fixture = await createFixture(context);
	const audioBytes = Uint8Array.of(1, 1, 1, 1);
	const videoBytes = Uint8Array.of(2, 2, 2, 2);
	const common = {
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		projectSha256: PROJECT_SHA256,
		storageKey: STORAGE_KEY,
	};
	const audio = await fixture.store.publishAudio({
		...common,
		byteLength: audioBytes.byteLength,
		sha256: digest(audioBytes),
		chunks: chunks(audioBytes),
	});
	const video = await fixture.store.publish({
		...common,
		encoding: DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
		byteLength: videoBytes.byteLength,
		sha256: digest(videoBytes),
		chunks: chunks(videoBytes),
	});

	assert.notEqual(audio.id, video.id);
	assert.deepEqual(await fixture.store.read(audio.id, { offset: 0, length: 4 }), audioBytes);
	assert.deepEqual(await fixture.store.read(video.id, { offset: 0, length: 4 }), videoBytes);
});

interface Fixture {
	readonly root: string;
	readonly store: DesktopLibraryManagedMediaStore;
	metadata: DesktopLibraryMetadata;
	onPublish: ((metadata: DesktopLibraryMetadata) => Promise<DesktopLibraryMetadata>) | null;
}

async function createFixture(context: TestContext): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), 'scape-library-video-media-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(root, { recursive: true, mode: 0o700 });
	const fixture = {
		root,
		metadata: validateDesktopLibraryMetadata({ schemaVersion: 3, revision: 0, projects: [], media: [] }),
		onPublish: null,
	} as Fixture;
	const catalog: DesktopLibraryMediaCatalogPort = {
		readMetadata: () => fixture.metadata,
		publishMetadata: async (candidate) => {
			const admitted = validateDesktopLibraryMetadata(candidate);
			if (fixture.onPublish) await fixture.onPublish(admitted);
			fixture.metadata = admitted;
			return admitted;
		},
	};
	Object.defineProperty(fixture, 'store', {
		value: new DesktopLibraryManagedMediaStore({
			managedMediaRoot: root,
			catalog,
			inventory: new TestDesktopLibraryManagedMediaInventoryPort(root),
			maximumChunkBytes: 4,
			maximumReadBytes: 4,
			randomId: () => 'a'.repeat(32),
		}),
		enumerable: true,
	});
	return fixture;
}

async function* chunks(...values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
	for (const value of values) yield value;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
