/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryAudioMediaBinding,
	DesktopLibraryManagedMediaStore,
	type DesktopLibraryMediaCatalogPort,
} from '../desktop/project-library-media.ts';
import {
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
} from '../desktop/project-library-contract.ts';

const PROJECT_ID = 'managed-audio-project';
const PROJECT_REVISION = 3;
const STORAGE_KEY = 'managed-audio-storage';

test('managed audio is fully materialized before its catalog row is published and supports bounded reads', async (context) => {
	const fixture = await createFixture(context, { maximumChunkBytes: 4, maximumReadBytes: 4 });
	const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
	const firstChunkWritten = deferred<void>();
	const continueBody = deferred<void>();
	const binding = createDesktopLibraryAudioMediaBinding(PROJECT_ID, STORAGE_KEY, PROJECT_REVISION);
	fixture.onPublish = async (metadata) => {
		assert.deepEqual(new Uint8Array(await readFile(join(fixture.root, ...binding.relativeFile.split('/')))), bytes);
		return metadata;
	};

	const publication = fixture.store.publishAudio({
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		storageKey: STORAGE_KEY,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
		chunks: (async function* () {
			yield bytes.subarray(0, 3);
			firstChunkWritten.resolve();
			await continueBody.promise;
			yield bytes.subarray(3);
		})(),
	});
	await firstChunkWritten.promise;
	assert.equal(fixture.publications.length, 0, 'an incomplete body must not enter metadata');
	continueBody.resolve();

	const descriptor = await publication;
	assert.deepEqual(descriptor, {
		id: binding.id,
		relativeFile: binding.relativeFile,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
	});
	assert.equal(fixture.publications.length, 1);
	assert.deepEqual(fixture.metadata.media, [descriptor]);
	assert.equal(fixture.metadata.revision, 1);
	assert.deepEqual(await fixture.store.read(binding.id, { offset: 1, length: 4 }), Uint8Array.of(2, 3, 4, 5));
	await assert.rejects(
		fixture.store.read(binding.id, { offset: 0, length: 5 }),
		/read length.*limit/iu,
	);
	await assert.rejects(
		fixture.store.read(`m${'f'.repeat(64)}`, { offset: 0, length: 1 }),
		/not present/iu,
	);
});

test('managed audio rejects short, overlong, and over-limit chunk streams without catalog publication', async (context) => {
	const short = await createFixture(context, { maximumChunkBytes: 4 });
	await assert.rejects(
		short.store.publishAudio({
			projectId: PROJECT_ID,
			projectRevision: PROJECT_REVISION,
			storageKey: STORAGE_KEY,
			byteLength: 4,
			sha256: digest(Uint8Array.of(1, 2, 3, 4)),
			chunks: chunks(Uint8Array.of(1, 2, 3)),
		}),
		/ended before.*declared byte length/iu,
	);
	await assertUnpublished(short);

	const overlong = await createFixture(context, { maximumChunkBytes: 4 });
	await assert.rejects(
		overlong.store.publishAudio({
			projectId: PROJECT_ID,
			projectRevision: PROJECT_REVISION,
			storageKey: STORAGE_KEY,
			byteLength: 3,
			sha256: digest(Uint8Array.of(1, 2, 3)),
			chunks: chunks(Uint8Array.of(1, 2), Uint8Array.of(3, 4)),
		}),
		/exceeds.*declared byte length/iu,
	);
	await assertUnpublished(overlong);

	const oversizedChunk = await createFixture(context, { maximumChunkBytes: 3 });
	await assert.rejects(
		oversizedChunk.store.publishAudio({
			projectId: PROJECT_ID,
			projectRevision: PROJECT_REVISION,
			storageKey: STORAGE_KEY,
			byteLength: 4,
			sha256: digest(Uint8Array.of(1, 2, 3, 4)),
			chunks: chunks(Uint8Array.of(1, 2, 3, 4)),
		}),
		/chunk.*byte limit/iu,
	);
	await assertUnpublished(oversizedChunk);
});

test('managed audio rejects a digest mismatch and removes its staged body', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(10, 20, 30, 40);
	await assert.rejects(
		fixture.store.publishAudio({
			projectId: PROJECT_ID,
			projectRevision: PROJECT_REVISION,
			storageKey: STORAGE_KEY,
			byteLength: bytes.byteLength,
			sha256: '0'.repeat(64),
			chunks: chunks(bytes),
		}),
		/SHA-256.*does not match/iu,
	);
	await assertUnpublished(fixture);
});

test('identical managed audio publication is idempotent and an immutable binding conflict fails closed', async (context) => {
	const fixture = await createFixture(context);
	const original = Uint8Array.of(9, 8, 7, 6);
	const declaration = {
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		storageKey: STORAGE_KEY,
		byteLength: original.byteLength,
		sha256: digest(original),
	};
	const first = await fixture.store.publishAudio({ ...declaration, chunks: chunks(original) });
	let duplicateReads = 0;
	const duplicate = await fixture.store.publishAudio({
		...declaration,
		chunks: (async function* () {
			duplicateReads += 1;
			throw new Error('an idempotent retry must not consume its body');
		})(),
	});
	assert.deepEqual(duplicate, first);
	assert.equal(duplicateReads, 0);
	assert.equal(fixture.publications.length, 1);

	const replacement = Uint8Array.of(6, 7, 8, 9);
	await assert.rejects(
		fixture.store.publishAudio({
			...declaration,
			sha256: digest(replacement),
			chunks: chunks(replacement),
		}),
		/immutable.*binding.*conflict/iu,
	);
	assert.equal(fixture.publications.length, 1);
	assert.deepEqual(new Uint8Array(await readFile(join(fixture.root, ...first.relativeFile.split('/')))), original);
});

test('the same managed-audio storage key has an immutable binding per project revision', async (context) => {
	const fixture = await createFixture(context);
	const original = Uint8Array.of(1, 2, 3, 4);
	const revised = Uint8Array.of(4, 3, 2, 1);
	const first = await fixture.store.publishAudio({
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		storageKey: STORAGE_KEY,
		byteLength: original.byteLength,
		sha256: digest(original),
		chunks: chunks(original),
	});
	const second = await fixture.store.publishAudio({
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION + 1,
		storageKey: STORAGE_KEY,
		byteLength: revised.byteLength,
		sha256: digest(revised),
		chunks: chunks(revised),
	});

	assert.notEqual(first.id, second.id);
	assert.deepEqual(fixture.metadata.media, [first, second]);
	assert.deepEqual(await fixture.store.read(first.id, { offset: 0, length: 4 }), original);
	assert.deepEqual(await fixture.store.read(second.id, { offset: 0, length: 4 }), revised);
});

test('a complete body survives catalog failure and is reused without consuming the retry stream', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(11, 22, 33, 44);
	const declaration = {
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		storageKey: STORAGE_KEY,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
	};
	fixture.onPublish = async () => { throw new Error('simulated catalog failure'); };
	await assert.rejects(
		fixture.store.publishAudio({ ...declaration, chunks: chunks(bytes) }),
		/simulated catalog failure/iu,
	);
	assert.equal(fixture.metadata.revision, 0);
	assert.deepEqual(fixture.metadata.media, []);
	fixture.onPublish = null;

	let retryReads = 0;
	const descriptor = await fixture.store.publishAudio({
		...declaration,
		chunks: (async function* () {
			retryReads += 1;
			throw new Error('a complete orphan retry must not consume its body');
		})(),
	});
	assert.equal(retryReads, 0);
	assert.deepEqual(fixture.metadata.media, [descriptor]);
	assert.equal(fixture.publications.length, 1);
});

test('managed audio rejects symlinked storage boundaries before consuming or publishing a body', {
	skip: process.platform === 'win32' ? 'portable Windows test runners may not permit symlink creation' : false,
}, async (context) => {
	const bytes = Uint8Array.of(4, 3, 2, 1);
	const declaration = {
		projectId: PROJECT_ID,
		projectRevision: PROJECT_REVISION,
		storageKey: STORAGE_KEY,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
	};
	const directoryFixture = await createFixture(context);
	const escapedDirectory = await mkdtemp(join(tmpdir(), 'scape-library-media-escape-'));
	context.after(() => rm(escapedDirectory, { recursive: true, force: true }));
	await symlink(escapedDirectory, join(directoryFixture.root, 'audio'), 'dir');
	await assert.rejects(
		directoryFixture.store.publishAudio({ ...declaration, chunks: chunks(bytes) }),
		/non-directory component/iu,
	);
	assert.deepEqual(await readdir(escapedDirectory), []);
	assert.deepEqual(directoryFixture.publications, []);

	const bodyFixture = await createFixture(context);
	const binding = createDesktopLibraryAudioMediaBinding(PROJECT_ID, STORAGE_KEY, PROJECT_REVISION);
	const finalPath = join(bodyFixture.root, ...binding.relativeFile.split('/'));
	await mkdir(dirname(finalPath), { recursive: true });
	const escapedBody = join(escapedDirectory, 'escaped-body.f32c');
	await writeFile(escapedBody, bytes);
	await symlink(escapedBody, finalPath, 'file');
	let chunksRead = 0;
	await assert.rejects(
		bodyFixture.store.publishAudio({
			...declaration,
			chunks: (async function* () {
				chunksRead += 1;
				yield bytes;
			})(),
		}),
		/not a regular file/iu,
	);
	assert.equal(chunksRead, 0);
	assert.deepEqual(bodyFixture.publications, []);
});

interface Fixture {
	readonly root: string;
	readonly store: DesktopLibraryManagedMediaStore;
	readonly publications: DesktopLibraryMetadata[];
	metadata: DesktopLibraryMetadata;
	onPublish: ((metadata: DesktopLibraryMetadata) => Promise<DesktopLibraryMetadata>) | null;
}

async function createFixture(
	context: TestContext,
	limits: Readonly<{ maximumChunkBytes?: number; maximumReadBytes?: number }> = {},
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), 'scape-library-media-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(root, { recursive: true, mode: 0o700 });
	const fixture = {
		root,
		metadata: validateDesktopLibraryMetadata({ schemaVersion: 2, revision: 0, projects: [], media: [] }),
		publications: [] as DesktopLibraryMetadata[],
		onPublish: null,
	} as Fixture;
	const catalog: DesktopLibraryMediaCatalogPort = {
		readMetadata: () => fixture.metadata,
		publishMetadata: async (candidate) => {
			const admitted = validateDesktopLibraryMetadata(candidate);
			if (fixture.onPublish) await fixture.onPublish(admitted);
			fixture.metadata = admitted;
			fixture.publications.push(admitted);
			return admitted;
		},
	};
	Object.defineProperty(fixture, 'store', {
		value: new DesktopLibraryManagedMediaStore({
			managedMediaRoot: root,
			catalog,
			randomId: () => 'a'.repeat(32),
			...limits,
		}),
		enumerable: true,
	});
	return fixture;
}

async function assertUnpublished(fixture: Fixture): Promise<void> {
	assert.equal(fixture.metadata.revision, 0);
	assert.deepEqual(fixture.metadata.media, []);
	assert.deepEqual(fixture.publications, []);
	assert.deepEqual(await listFiles(fixture.root), []);
}

async function listFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else files.push(path);
		}
	};
	await visit(root);
	return files;
}

async function* chunks(...values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
	for (const value of values) yield value;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
