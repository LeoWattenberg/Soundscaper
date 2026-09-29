/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	readScapeArchiveEnvelope,
	type ScapeArchiveEntry,
} from '../src/common/editor/scape-archive-envelope.ts';

const encoder = new TextEncoder();

function metadataEntry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return {
		filename,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: bytes.byteLength,
		uncompressedSize: bytes.byteLength,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const writer = writable.getWriter();
			await writer.write(bytes);
			await writer.close();
		},
	};
}

function archiveEntries(invalidMember: 'manifest.json' | 'project.json'): ScapeArchiveEntry[] {
	const projectBytes = encoder.encode(JSON.stringify({
		id: 'utf8-project', schemaFamily: 'soundscaper', schemaVersion: 1, title: 'X',
	}));
	const manifestBytes = encoder.encode(JSON.stringify({
		format: 'scape-project', formatVersion: 1, createdAt: 'X',
		project: {
			entry: 'project.json', size: projectBytes.byteLength, sha256: '0'.repeat(64),
			schemaFamily: 'soundscaper', schemaVersion: 1,
		},
		assets: [],
	}));
	const bytes = invalidMember === 'manifest.json' ? manifestBytes : projectBytes;
	const marker = bytes.indexOf('X'.charCodeAt(0));
	assert.notEqual(marker, -1);
	bytes[marker] = 0xff;
	return [
		metadataEntry('manifest.json', manifestBytes),
		metadataEntry('project.json', projectBytes),
	];
}

for (const member of ['manifest.json', 'project.json'] as const) {
	test(`Scape envelope rejects invalid UTF-8 in ${member}`, async () => {
		await assert.rejects(readScapeArchiveEnvelope(archiveEntries(member)), /UTF-8|encoded data/iu);
	});
}
