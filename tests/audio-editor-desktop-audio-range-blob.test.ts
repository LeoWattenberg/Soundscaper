/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAudioRangeBlob } from '../src/common/editor/desktop-audio-range-blob.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

const id = 'a'.repeat(64);
const descriptor = Object.freeze({ id, name: 'long.wav', size: 900_000_000, mimeType: 'audio/wav',
	readProfile: 'linked-audio-range-v1', lastModified: 0,
	url: `soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/${id}/long.wav` });

test('desktop audio Blob ranges retain no whole-file allocation and validate exact transport', async () => {
	const calls: string[] = [];
	const blob = createDesktopAudioRangeBlob(descriptor, { fetch: async (_url, init) => {
		const range = new Headers(init.headers).get('Range')!;
		calls.push(range);
		const [, first, last] = /^bytes=(\d+)-(\d+)$/u.exec(range)!;
		const start = Number(first); const end = Number(last);
		return new Response(new Uint8Array(end - start + 1).fill(start % 256), { status: 206, headers: {
			'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${descriptor.size}`,
			'Content-Length': String(end - start + 1), 'Content-Type': descriptor.mimeType,
		} });
	} });
	assert.ok(blob instanceof Blob);
	assert.equal(blob.size, descriptor.size);
	assert.equal(blob.type, 'audio/wav');
	assert.equal((blob as Blob & { name: string }).name, 'long.wav');
	assert.deepEqual(new Uint8Array(await blob.slice(12, 18).slice(1, 3).arrayBuffer()), new Uint8Array([13, 13]));
	assert.deepEqual(calls, ['bytes=13-14']);
	await assert.rejects(() => blob.arrayBuffer(), /bounded/u);
	await assert.rejects(() => blob.slice(0, 4 * 1024 ** 2 + 1).arrayBuffer(), /bounded/u);
});

test('range-backed files remain alive only within their awaited desktop read scope', async () => {
	const releases: string[] = [];
	const service = createAudioEditorFileService({ bridge: { releaseRead(readId: string) { releases.push(readId); } },
		fetch: async () => { throw new Error('no eager fetch allowed'); } });
	let retained: Blob | null = null;
	await service.withReadDescriptors([descriptor], {}, async (files: readonly Blob[]) => {
		retained = files[0]!;
		assert.equal(retained.size, descriptor.size);
		await Promise.resolve();
		assert.deepEqual(releases, []);
	});
	assert.deepEqual(releases, [id]);
	await assert.rejects(() => retained!.slice(0, 1).arrayBuffer(), /released/u);
});
