/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_EXPORT_BLOB_MAXIMUM_BYTES,
	assertBrowserExportOutputSize,
	prepareBrowserExportBlob,
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

test('browser export Blob preparation admits bytes before construction and preserves admitted Blobs', () => {
	const existing = new Blob([Uint8Array.of(1, 2)], { type: 'audio/wav' });
	assert.equal(prepareBrowserExportBlob({ blob: existing }, 'Audio export', 2), existing);
	assert.equal(
		prepareBrowserExportBlob(
			{ bytes: Uint8Array.of(1, 2), mimeType: 'video/mp4' },
			'Video export',
			2,
		).type,
		'video/mp4',
	);

	const originalBlobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob');
	assert.ok(originalBlobDescriptor);
	const OriginalBlob = globalThis.Blob;
	let constructionCount = 0;
	class ObservedBlob extends OriginalBlob {
		constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
			constructionCount += 1;
			super(parts, options);
		}
	}
	Object.defineProperty(globalThis, 'Blob', { ...originalBlobDescriptor, value: ObservedBlob });
	try {
		assert.throws(
			() => prepareBrowserExportBlob(
				{ bytes: Uint8Array.of(1, 2, 3), mimeType: 'audio/mpeg' },
				'Audio export',
				2,
			),
			/Audio export.*maximum is 2 bytes/u,
		);
		assert.equal(constructionCount, 0);
	} finally {
		Object.defineProperty(globalThis, 'Blob', originalBlobDescriptor);
	}
});

test('browser export Blob preparation rejects malformed encoder ownership', () => {
	for (const output of [{}, { blob: {} }, { bytes: 'not bytes' }]) {
		assert.throws(
			() => prepareBrowserExportBlob(output, 'Audio export'),
			/encoded output|Blob/u,
		);
	}
});
