/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createImportedAudioContentIdentityWriter,
} from '../src/common/editor/controller/imported-audio-content-identity.ts';
import { packPlanarFloat32 } from '../src/common/editor/wavpack/index.js';

test('imported audio identity authenticates canonical PCM as chunks are persisted', async () => {
	const writes: readonly Float32Array[][] = [];
	const storageWriter = {
		async write(channels: readonly Float32Array[]) {
			(writes as Float32Array[][]).push(channels.map((channel) => channel.slice()));
		},
		async commit() { return Object.freeze({ chunkCount: 2 }); },
		async abort() { throw new Error('A successful writer must not abort.'); },
	};
	const writer = createImportedAudioContentIdentityWriter(storageWriter, 3);
	const first = [Float32Array.of(0.25, -0.5, 0.75), Float32Array.of(1, -1, 0.5)];
	const second = [Float32Array.of(0.125), Float32Array.of(-0.125)];
	await writer.write(first);
	await writer.write(second);
	await writer.commit();

	assert.deepEqual(writes, [first, second]);
	assert.deepEqual(writer.contentIdentity(4), canonicalIdentity([first, second]));
});

test('imported audio identity refuses malformed, stale, and noncanonical evidence', async () => {
	const body = [Float32Array.of(0.25, -0.5)];
	for (const metadata of [
		{ sha256: 'not-a-digest', byteLength: 12 },
		{ sha256: '0'.repeat(64), byteLength: 12 },
		{ sha256: canonicalIdentity([body]).contentSha256, byteLength: 13 },
	]) {
		const writer = createImportedAudioContentIdentityWriter({
			async write() { return undefined; },
			async commit() { return metadata; },
			async abort() { return undefined; },
		}, 2);
		await writer.write(body);
		await writer.commit();
		assert.throws(() => writer.contentIdentity(2), /content (?:digest|byte length).*disagrees|invalid/iu);
	}

	const irregular = createImportedAudioContentIdentityWriter({
		async write() { return undefined; },
		async commit() { return {}; },
		async abort() { return undefined; },
	}, 3);
	await irregular.write([Float32Array.of(0, 1)]);
	await assert.rejects(
		irregular.write([Float32Array.of(2)]),
		/non-final imported PCM chunk/iu,
	);
});

function canonicalIdentity(chunks: readonly (readonly Float32Array[])[]): Readonly<{
	contentSha256: string;
	byteLength: number;
}> {
	const digest = sha256.create();
	let byteLength = 0;
	for (const channels of chunks) {
		const header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, channels[0]!.length, true);
		const pcm = new Uint8Array(packPlanarFloat32(channels));
		digest.update(header);
		digest.update(pcm);
		byteLength += header.byteLength + pcm.byteLength;
	}
	return Object.freeze({ contentSha256: bytesToHex(digest.digest()), byteLength });
}
