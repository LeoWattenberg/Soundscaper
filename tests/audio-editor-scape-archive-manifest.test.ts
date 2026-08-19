/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createArchiveManifestFromStreams,
	compareArchiveManifests,
} from '../src/common/editor/archive-manifest.ts';
import {
	createScapeArchiveManifest,
	verifyScapeArchiveManifest,
} from '../src/common/editor/scape-archive-manifest.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

const PROJECT = new TextEncoder().encode('{"schemaVersion":9}');
const MEDIA = Uint8Array.from({ length: 5_000 }, (_value, index) => index % 253);

test('a manifest is built from the bytes the finished archive actually holds', async () => {
	const manifest = await createScapeArchiveManifest(
		new Blob([Uint8Array.of(0)]),
		{ createReader: reader(members()), projectTitle: 'Cafe Film', generatedAt: '2026-08-19T00:00:00.000Z' },
	);

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

test('directories are not members and an unnamed entry is refused', async () => {
	const withDirectory = await createScapeArchiveManifest(new Blob([Uint8Array.of(0)]), {
		createReader: reader([
			{ filename: 'media/', directory: true, bytes: new Uint8Array(0) },
			...members(),
		]),
	});
	assert.deepEqual(withDirectory.members.map(({ id }) => id), ['media/a.wav', 'project.json']);

	await assert.rejects(createScapeArchiveManifest(new Blob([Uint8Array.of(0)]), {
		createReader: reader([{ filename: '', directory: false, bytes: PROJECT }]),
	}), /no name to record/u);
});

test('a member is digested as it streams rather than being held whole', async () => {
	let largestChunk = 0;
	const manifest = await createScapeArchiveManifest(new Blob([Uint8Array.of(0)]), {
		createReader: reader(members(), (chunk) => {
			largestChunk = Math.max(largestChunk, chunk.byteLength);
		}),
	});

	assert.equal(manifest.members.find(({ id }) => id === 'media/a.wav')?.byteLength, MEDIA.byteLength);
	assert.ok(
		largestChunk < MEDIA.byteLength,
		'a reference-scale member must never have to fit in one buffer',
	);
});

test('verification names every member that drifted, and every one the manifest never listed', async () => {
	const original = await createScapeArchiveManifest(
		new Blob([Uint8Array.of(0)]), { createReader: reader(members()) },
	);

	const tampered = members();
	tampered[0] = { ...tampered[0]!, bytes: Uint8Array.from(MEDIA, (value) => value ^ 1) };
	const substitution = await verifyScapeArchiveManifest(new Blob([Uint8Array.of(0)]), original, {
		createReader: reader(tampered),
	});
	assert.equal(substitution.ok, false);
	assert.deepEqual(substitution.mismatches.map(({ kind }) => kind), ['digest']);
	assert.equal(substitution.mismatches[0]?.member, 'media/a.wav');

	// Truncation moves size and digest together; substitution usually only the
	// digest, and telling them apart is the point of checking both.
	const truncated = members();
	truncated[0] = { ...truncated[0]!, bytes: MEDIA.subarray(0, 2_000) };
	const shortened = await verifyScapeArchiveManifest(new Blob([Uint8Array.of(0)]), original, {
		createReader: reader(truncated),
	});
	assert.deepEqual(shortened.mismatches.map(({ kind }) => kind), ['size', 'digest']);

	const extra = await verifyScapeArchiveManifest(new Blob([Uint8Array.of(0)]), original, {
		createReader: reader([...members(), { filename: 'media/b.wav', directory: false, bytes: MEDIA }]),
	});
	assert.deepEqual(extra.mismatches.map(({ kind, member }) => `${kind}:${member}`), ['unlisted:media/b.wav']);

	const missing = await verifyScapeArchiveManifest(new Blob([Uint8Array.of(0)]), original, {
		createReader: reader(members().slice(1)),
	});
	assert.deepEqual(missing.mismatches.map(({ kind }) => kind), ['missing']);
});

test('an untouched archive verifies, and every member is counted', async () => {
	const manifest = await createScapeArchiveManifest(
		new Blob([Uint8Array.of(0)]), { createReader: reader(members()) },
	);
	const verification = await verifyScapeArchiveManifest(new Blob([Uint8Array.of(0)]), manifest, {
		createReader: reader(members()),
	});

	assert.equal(verification.ok, true);
	assert.equal(verification.checked, 2);
	assert.deepEqual(verification.mismatches, []);
});

test('comparing two manifests reports the same four kinds the byte reader does', async () => {
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

function members() {
	return [
		{ filename: 'media/a.wav', directory: false, bytes: MEDIA },
		{ filename: 'project.json', directory: false, bytes: PROJECT },
	];
}

async function* chunksOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	for (let offset = 0; offset < bytes.byteLength; offset += 512) {
		yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + 512));
	}
}

/** A reader that hands out entries the way the Zip reader does, in chunks. */
function reader(
	entries: readonly Readonly<{ filename: string; directory: boolean; bytes: Uint8Array }>[],
	onChunk: (chunk: Uint8Array) => void = () => undefined,
) {
	return () => ({
		async *getEntriesGenerator() {
			for (const entry of entries) {
				yield {
					filename: entry.filename,
					directory: entry.directory,
					encrypted: false,
					compressionMethod: 0,
					compressedSize: entry.bytes.byteLength,
					uncompressedSize: entry.bytes.byteLength,
					async getData(writable: WritableStream<Uint8Array>) {
						const writer = writable.getWriter();
						for (let offset = 0; offset < entry.bytes.byteLength; offset += 512) {
							const chunk = entry.bytes.subarray(offset, Math.min(entry.bytes.byteLength, offset + 512));
							onChunk(chunk);
							await writer.write(chunk);
						}
						await writer.close();
					},
				};
			}
			return true;
		},
		async close() {},
	});
}
