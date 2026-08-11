/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	rewriteScapeManifest,
	rewriteScapeProjectDocument,
} from './helpers/scape-archive-rewrite.js';

const SOURCE_ID = 'copy-audio-source';

test('a future V16 archive copies byte-for-byte from Blob and byte-source inputs', async (context) => {
	const future = await futureArchive(context);
	const original = new Uint8Array(await future.arrayBuffer());

	const fromBlob = await collectCopy(future);
	assert.equal(fromBlob.result.schemaVersion, 16);
	assert.equal(fromBlob.result.byteLength, original.byteLength);
	assert.deepEqual(fromBlob.bytes, original, 'the Blob copy must be the exact original bytes');
	assert.equal(digestScapeBytes(fromBlob.bytes), digestScapeBytes(original));

	const fromByteSource = await collectCopy(createScapeArchiveByteSource({
		size: original.byteLength,
		maximumReadBytes: 7,
		read: ({ offset, length }) => original.subarray(offset, offset + length),
	}));
	assert.deepEqual(fromByteSource.bytes, original, 'the byte-source copy must be the exact original bytes');
});

test('current-schema and mismatched or unknown-format archives refuse the unchanged copy', async (context) => {
	const current = await currentArchive(context);
	await assert.rejects(collectCopy(current), /future-schema/iu);

	const mismatched = await rewriteScapeManifest(
		await futureArchive(context),
		(manifest: { project: { schemaVersion: number } }) => { manifest.project.schemaVersion = 17; },
	);
	await assert.rejects(collectCopy(mismatched), /does not match its project document/u);

	const unknownFormat = await rewriteScapeManifest(
		await futureArchive(context),
		(manifest: { formatVersion: number }) => { manifest.formatVersion = 2; },
	);
	await assert.rejects(collectCopy(unknownFormat), /format/iu);
});

test('a tampered project document fails digest verification before any copy bytes flow', async (context) => {
	const future = await futureArchive(context);
	const tampered = await rewriteScapeManifest(future, (manifest: { project: { sha256: string } }) => {
		manifest.project.sha256 = '0'.repeat(64);
	});
	const written: Uint8Array[] = [];
	await assert.rejects(
		copyFutureScapeArchive(tampered, (bytes) => { written.push(bytes); }),
		/SHA-256/u,
	);
	assert.deepEqual(written, [], 'a refused archive must emit no copy bytes');
});

test('cancellation stops the unchanged copy with the abort reason', async (context) => {
	const future = await futureArchive(context);
	const controller = new AbortController();
	const reason = new Error('cancel unchanged archive copy');
	controller.abort(reason);
	await assert.rejects(
		copyFutureScapeArchive(future, () => undefined, { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
});

async function futureArchive(context: TestContext): Promise<Blob> {
	return rewriteScapeProjectDocument(
		await currentArchive(context),
		(document: { schemaVersion: number }) => { document.schemaVersion = 16; },
	);
}

async function currentArchive(context: TestContext): Promise<Blob> {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `scape-archive-copy-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite(SOURCE_ID, {
		name: 'copy.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([Float32Array.of(0.25, -0.5, 0.75, 0)]);
	await writer.commit();
	const clip = createAudioClipV9({
		id: 'copy-clip', sourceId: SOURCE_ID, timelineStartFrame: 0, durationFrames: 4,
	});
	const project = createCurrentAudioEditorProject({
		id: 'scape-archive-copy-project',
		title: 'Unchanged copy fixture',
		now: '2026-08-08T17:00:00.000Z',
		sampleRate: 48_000,
		sources: [createAudioSourceV9({
			id: SOURCE_ID, storageKey: SOURCE_ID, name: 'copy.wav', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1,
		})],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'copy-track', name: 'Copy', clipIds: [clip.id] })],
	});
	const exported = await exportScapeProject(project, store);
	if (!(exported.blob instanceof Blob)) throw new TypeError('Expected an assembled archive Blob.');
	return exported.blob;
}

async function collectCopy(input: Blob | ReturnType<typeof createScapeArchiveByteSource>) {
	const chunks: Uint8Array[] = [];
	const result = await copyFutureScapeArchive(input, (bytes) => { chunks.push(bytes); });
	const bytes = new Uint8Array(result.byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { bytes, result };
}
