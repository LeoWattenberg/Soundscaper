/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_EXPORT_BLOB_MAXIMUM_BYTES,
	assertBrowserExportOutputSize,
	readBoundedFfmpegOutputFile,
} from '../src/common/editor/browser-export-output.ts';

test('browser export output uses a frozen 512 MiB ceiling with lower-only overrides', () => {
	assert.equal(BROWSER_EXPORT_BLOB_MAXIMUM_BYTES, 512 * 1024 * 1024);
	assert.equal(assertBrowserExportOutputSize(2, 'Audio export', 2), 2);
	assert.throws(
		() => assertBrowserExportOutputSize(3, 'Audio export', 2),
		/Audio export.*3 bytes.*maximum is 2 bytes/u,
	);
	for (const maximum of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity, Number.NaN]) {
		assert.throws(
			() => assertBrowserExportOutputSize(1, 'Audio export', maximum),
			/browser export maximumBytes/u,
		);
	}
});

test('bounded FFmpeg whole-file reads stat before reading and require exact bytes', async () => {
	const events: string[] = [];
	const bytes = Uint8Array.of(1, 2, 3);
	const output = await readBoundedFfmpegOutputFile({
		async statFile(path): Promise<{ size: number }> {
			events.push(`stat:${path}`);
			return { size: bytes.byteLength };
		},
		async readFile(path): Promise<Uint8Array> {
			events.push(`read:${path}`);
			return bytes;
		},
	}, 'output.mp3', { label: 'Audio export', maximumBytes: bytes.byteLength });

	assert.equal(output, bytes);
	assert.deepEqual(events, ['stat:output.mp3', 'read:output.mp3']);
});

test('bounded FFmpeg whole-file reads refuse malformed and oversized metadata before readFile', async () => {
	for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, Number.NaN, 4]) {
		let readCalls = 0;
		await assert.rejects(
			readBoundedFfmpegOutputFile({
				async statFile(): Promise<{ size: number }> { return { size }; },
				async readFile(): Promise<Uint8Array> { readCalls += 1; return Uint8Array.of(1); },
			}, 'output.webm', { label: 'Video export', maximumBytes: 3 }),
		);
		assert.equal(readCalls, 0);
	}
});

test('bounded FFmpeg whole-file reads reject type and stat/read length drift', async () => {
	for (const output of [Uint8Array.of(1), 'x']) {
		await assert.rejects(
			readBoundedFfmpegOutputFile({
				async statFile(): Promise<{ size: number }> { return { size: 2 }; },
				async readFile(): Promise<unknown> { return output; },
			}, 'output.mp4'),
			/FFmpeg output/u,
		);
	}
});
