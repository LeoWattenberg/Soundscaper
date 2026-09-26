/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAup4DesktopRangeFile } from '../src/common/editor/aup4-worker-desktop-range-file.ts';

test('Audacity worker reads the final bytes of a 7 GiB selected project without cloning it', async () => {
	const size = 7 * 1024 ** 3;
	const id = 'a'.repeat(64);
	const mimeType = 'application/vnd.audacity.aup4';
	const ranges: string[] = [];
	const source = createAup4DesktopRangeFile({ id, name: 'large.aup4', size, mimeType,
		readProfile: 'selected-range-v1', lastModified: 0,
		url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/large.aup4`,
	}, async (_url, init) => {
		const range = new Headers(init.headers).get('Range')!;
		ranges.push(range);
		const match = /^bytes=(\d+)-(\d+)$/u.exec(range)!;
		const length = Number(match[2]) - Number(match[1]) + 1;
		return new Response(new Uint8Array(length).fill(0x53), { status: 206, headers: {
			'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${match[1]}-${match[2]}/${size}`,
			'Content-Length': String(length), 'Content-Type': mimeType,
		} });
	});
	assert.equal(source.size, size);
	assert.deepEqual(new Uint8Array(await source.slice(size - 3, size).arrayBuffer()), new Uint8Array([0x53, 0x53, 0x53]));
	assert.deepEqual(ranges, [`bytes=${size - 3}-${size - 1}`]);
});
