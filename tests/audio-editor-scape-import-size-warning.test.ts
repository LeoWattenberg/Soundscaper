/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readScapeArchiveEnvelope, type ScapeArchiveEntry } from '../src/common/editor/scape-archive-envelope.ts';

function fixture() {
	let reads = 0;
	const project = JSON.stringify({ id: 'project', schemaFamily: 'soundscaper', schemaVersion: 1 });
	const manifest = JSON.stringify({ format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', size: project.length, sha256: '0'.repeat(64),
			schemaFamily: 'soundscaper', schemaVersion: 1 }, assets: [] });
	const entries: ScapeArchiveEntry[] = [['manifest.json', manifest], ['project.json', project]].map(([filename, text]) => {
		const bytes = new TextEncoder().encode(text);
		return { filename, directory: false, encrypted: false, compressionMethod: 0,
			compressedSize: bytes.length, uncompressedSize: bytes.length,
			getData: async (writable, options) => {
				if (options?.checkOverlappingEntryOnly) return;
				reads += 1;
				const writer = writable.getWriter(); await writer.write(bytes); await writer.close();
			} };
	});
	return { entries, reads: () => reads, project };
}

test('Scape import admits expanded archive and metadata sizes after explicit approval', async () => {
	const input = fixture(), warnings: string[] = [];
	const envelope = await readScapeArchiveEnvelope(input.entries,
		{ maximumExpandedBytes: 1, maximumManifestBytes: 1, maximumProjectBytes: 1 }, undefined, [], false,
		{ confirmFileSizeWarning: async (warning) => { warnings.push(warning.label); return true; } });
	assert.equal(envelope.projectText, input.project);
	assert.equal(envelope.expandedByteBudget.maximumBytes, input.entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0));
	assert.deepEqual(warnings, ['Scape project archive', 'manifest.json', 'project.json']);
	assert.equal(input.reads(), 2);
});

test('Scape import cancellation declines its aggregate warning before reading metadata bodies', async () => {
	const input = fixture();
	await assert.rejects(readScapeArchiveEnvelope(input.entries, { maximumExpandedBytes: 1 }, undefined, [], false,
		{ confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
	assert.equal(input.reads(), 0);
});

test('Scape size approval preserves STORE consistency and exact streamed metadata bounds', async () => {
	const input = fixture();
	let prompts = 0;
	const options = { confirmFileSizeWarning: async () => { prompts += 1; return true; } };
	input.entries[0]!.compressedSize -= 1;
	await assert.rejects(readScapeArchiveEnvelope(input.entries, { maximumExpandedBytes: 1 }, undefined, [], false, options), /inconsistent/);
	assert.equal(prompts, 0);
	input.entries[0]!.uncompressedSize -= 1;
	await assert.rejects(readScapeArchiveEnvelope(input.entries, { maximumManifestBytes: 1 }, undefined, [], false, options), /read limit/);
	assert.equal(input.reads(), 1);
});
