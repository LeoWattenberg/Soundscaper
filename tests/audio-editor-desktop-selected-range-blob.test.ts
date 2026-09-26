/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';
import { readDawprojectArchive, writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';

const id = 'a'.repeat(64);
const size = 7 * 1024 ** 3;
const descriptor = Object.freeze({
	id, name: 'large.aup4', size, mimeType: 'application/vnd.audacity.aup4',
	readProfile: 'selected-range-v1', lastModified: 0,
	url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/large.aup4`,
});

test('a 7 GiB native selection reads only requested ranges and retires with its scope', async () => {
	const calls: string[] = [];
	const blob = createDesktopSelectedRangeBlob(descriptor, { fetch: async (_url, init) => {
		const range = new Headers(init.headers).get('Range')!;
		calls.push(range);
		const match = /^bytes=(\d+)-(\d+)$/u.exec(range)!;
		const length = Number(match[2]) - Number(match[1]) + 1;
		return new Response(new Uint8Array(length).fill(0x41), { status: 206, headers: {
			'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${match[1]}-${match[2]}/${size}`,
			'Content-Length': String(length), 'Content-Type': descriptor.mimeType,
		} });
	} });
	assert.equal(blob.size, size);
	assert.equal((blob as Blob & { name: string }).name, 'large.aup4');
	assert.equal(new TextDecoder().decode(await blob.slice(size - 3, size).arrayBuffer()), 'AAA');
	assert.deepEqual(calls, [`bytes=${size - 3}-${size - 1}`]);
	retireDesktopSelectedRangeBlob(blob);
	await assert.rejects(blob.slice(0, 1).arrayBuffer(), /released/u);
});

test('ZIP import reads a selected desktop range Blob through zip.js slices', async () => {
	const archive = await writeDawprojectArchive({ projectXml: '<Project/>', metadataXml: '', files: [] });
	const bytes = new Uint8Array(await archive.arrayBuffer());
	const name = 'session.dawproject';
	const selected = createDesktopSelectedRangeBlob({
		id, name, size: bytes.byteLength, mimeType: 'application/zip',
		readProfile: 'selected-range-v1', lastModified: 0,
		url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/${name}`,
	}, { fetch: async (_url, init) => {
		const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range')!)!;
		const start = Number(range[1]); const end = Number(range[2]);
		return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
			'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
			'Content-Length': String(end - start + 1), 'Content-Type': 'application/zip',
		} });
	} });
	const read = await readDawprojectArchive(selected);
	try { assert.equal(read.projectXml, '<Project/>'); }
	finally { await read.close(); retireDesktopSelectedRangeBlob(selected); }
});

test('selected desktop ranges preserve valid file names with surrounding spaces', () => {
	const name = ' song.mp3 ';
	const blob = createDesktopSelectedRangeBlob({ ...descriptor, name,
		url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/${encodeURIComponent(name)}`,
	}, { fetch: async () => { throw new Error('No bytes requested'); } });
	assert.equal((blob as Blob & { name: string }).name, name);
});
