/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobWriter,
	Uint8ArrayReader,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	createArchiveManifestFromStreams,
	compareArchiveManifests,
} from '../src/common/editor/archive-manifest.ts';
import * as scapeArchiveManifest from '../src/common/editor/scape-archive-manifest.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

const { createScapeArchiveManifest } = scapeArchiveManifest;
const PROJECT = new TextEncoder().encode('{"schemaVersion":9}');
const MEDIA = Uint8Array.from({ length: 5_000 }, (_value, index) => index % 253);

test('a manifest is built by the real archive reader from the finished ZIP bytes', async () => {
	const manifest = await createScapeArchiveManifest(await archive(), {
		projectTitle: 'Cafe Film', signal: new AbortController().signal,
	});

	assert.equal(manifest.kind, 'archive-manifest');
	assert.equal(manifest.projectTitle, 'Cafe Film');
	assert.deepEqual(manifest.members.map(({ id }) => id), ['media/a.wav', 'project.json']);
	assert.equal(manifest.totalByteLength, PROJECT.byteLength + MEDIA.byteLength);
	// Digested from the archive, never copied from the writer's own account.
	assert.equal(
		manifest.members.find(({ id }) => id === 'media/a.wav')?.sha256,
		digestScapeBytes(MEDIA),
	);
});

test('directory entries are not checksum members', async () => {
	const manifest = await createScapeArchiveManifest(await archive(true), {
		signal: new AbortController().signal,
	});

	assert.deepEqual(manifest.members.map(({ id }) => id), ['media/a.wav', 'project.json']);
});

test('manifest creation obeys cancellation before opening an archive', async () => {
	const controller = new AbortController();
	controller.abort(new DOMException('Stop reading', 'AbortError'));
	await assert.rejects(createScapeArchiveManifest(await archive(), {
		signal: controller.signal,
	}), { name: 'AbortError' });
});

test('the archive-manifest runtime does not publish an unshipped verification action', () => {
	assert.equal('verifyScapeArchiveManifest' in scapeArchiveManifest, false);
});

test('comparing two manifests reports missing, size, digest and unlisted members', async () => {
	const expected = await createArchiveManifestFromStreams([
		{ id: 'a', chunks: chunksOf(MEDIA) },
		{ id: 'b', chunks: chunksOf(PROJECT) },
	]);
	const observed = await createArchiveManifestFromStreams([
		{ id: 'b', chunks: chunksOf(PROJECT.subarray(0, 4)) },
		{ id: 'c', chunks: chunksOf(PROJECT) },
	]);

	assert.deepEqual(
		compareArchiveManifests(expected, observed).mismatches.map(({ kind, member }) => `${kind}:${member}`),
		['missing:a', 'size:b', 'digest:b', 'unlisted:c'],
	);
});

async function archive(withDirectory = false): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
	});
	if (withDirectory) await writer.add('media/', undefined, { directory: true });
	await writer.add('media/a.wav', new Uint8ArrayReader(MEDIA), { level: 0 });
	await writer.add('project.json', new Uint8ArrayReader(PROJECT), { level: 0 });
	return writer.close();
}

async function* chunksOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	for (let offset = 0; offset < bytes.byteLength; offset += 512) {
		yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + 512));
	}
}
