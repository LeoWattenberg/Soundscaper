/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	readScapeArchiveEnvelope,
	SCAPE_ARCHIVE_LIMITS,
	type ScapeArchiveEntry,
} from '../src/common/editor/scape-archive-envelope.ts';

test('desktop Scape envelope admits STORE media beyond the browser expansion ceiling', async () => {
	const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
	const projectBytes = encode(JSON.stringify({ id: 'large-desktop-scape', schemaFamily: 'soundscaper', schemaVersion: 1 }));
	const expandedSize = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes + 1;
	const manifestBytes = encode(JSON.stringify({
		format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: 'soundscaper', schemaVersion: 1,
			size: projectBytes.byteLength, sha256: '0'.repeat(64) },
		assets: [{ entry: 'media/large/original', sourceId: 'large', kind: 'video',
			encoding: 'original', size: expandedSize, sha256: '0'.repeat(64) }],
	}));
	let assetReads = 0;
	const entry = (filename: string, bytes: Uint8Array, size = bytes.byteLength): ScapeArchiveEntry => ({
		filename, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: size, uncompressedSize: size,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			if (filename === 'media/large/original') assetReads += 1;
			const writer = writable.getWriter();
			await writer.write(bytes);
			await writer.close();
		},
	});
	const entries = [entry('manifest.json', manifestBytes), entry('project.json', projectBytes),
		entry('media/large/original', new Uint8Array(), expandedSize)];
	await assert.rejects(readScapeArchiveEnvelope(entries), /declared expansion limit/iu);
	const admitted = await readScapeArchiveEnvelope(entries, {}, undefined, [], true);
	assert.equal(admitted.entryByName.get('media/large/original')?.uncompressedSize, expandedSize);
	assert.equal(assetReads, 0, 'envelope admission does not read the large media body');
});
