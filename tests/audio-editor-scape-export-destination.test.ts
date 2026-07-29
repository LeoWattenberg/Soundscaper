/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES,
	createScapeExportDestination,
} from '../src/common/editor/scape-export-destination.ts';

test('streamed Scape destination rechunks output, counts exact bytes, and closes once', async () => {
	const chunks: number[] = [];
	let closes = 0;
	const writable = new WritableStream<Uint8Array>({
		write(chunk) { chunks.push(chunk.byteLength); },
		close() { closes += 1; },
	});
	const output = createScapeExportDestination(
		writable,
		'application/zip',
		SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES + 7,
	);
	assert.ok(output.target instanceof WritableStream);
	const writer = output.target.getWriter();
	await writer.write(new Uint8Array(SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES + 7));
	writer.releaseLock();
	await output.finish({ close: async () => undefined });

	assert.deepEqual(chunks, [SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES, 7]);
	assert.equal(output.byteLength, SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES + 7);
	assert.equal(closes, 1);
});

test('streamed Scape destination rejects its admitted maximum and aborts unpublished output', async () => {
	const aborts: unknown[] = [];
	const writable = new WritableStream<Uint8Array>({
		abort(reason) { aborts.push(reason); },
	});
	const output = createScapeExportDestination(writable, 'application/zip', 1);
	assert.ok(output.target instanceof WritableStream);
	const writer = output.target.getWriter();
	const failure = await writer.write(Uint8Array.of(1, 2)).catch((error: unknown) => error);
	writer.releaseLock();
	await assert.rejects(
		output.abort({ close: async () => undefined }, failure),
		/admitted maximum/iu,
	);
	assert.equal(output.byteLength, 0);
	assert.equal(aborts.length, 1);
});
