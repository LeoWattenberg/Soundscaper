/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	downloadFreesoundImport,
	FreesoundOriginalTooLargeError,
} from '../src/common/editor/controller/import/internal/freesound-import-download.ts';

const SOUND = Object.freeze({
	id: 42,
	name: 'Rain close.ogg',
	preview: { available: true },
	originalFile: { byteLength: 4_096, format: 'ogg' },
});
const ORIGINAL_URL = new URL('https://soundscaper.org/api/freesound/sounds/42/original');

test('original download reports a size rejection and preserves a useful upstream error', async () => {
	const options = {
		sound: SOUND,
		variant: 'original' as const,
		maximumOriginalBytes: 8_192,
		maximumPreviewBytes: 1_024,
		url: ORIGINAL_URL,
	};
	await assert.rejects(downloadFreesoundImport({
		...options,
		fetch: async () => new Response(null, { status: 413 }),
	}), (error: unknown) => {
		assert.ok(error instanceof FreesoundOriginalTooLargeError);
		assert.equal(error.byteLength, SOUND.originalFile.byteLength);
		return true;
	});
	await assert.rejects(downloadFreesoundImport({
		...options,
		fetch: async () => Response.json({ error: { message: 'Upstream quota exhausted' } }, { status: 429 }),
	}), /Upstream quota exhausted \(429\)/u);
	await assert.rejects(downloadFreesoundImport({
		...options,
		fetch: async () => new Response('not JSON', { status: 502 }),
	}), /Freesound original download failed \(502\)/u);
});

test('original download uses a safe format fallback for ambiguous MIME and filenames', async () => {
	const download = await downloadFreesoundImport({
		sound: { ...SOUND, name: '../storm?.flac', originalFile: {
			...SOUND.originalFile, format: 'flac',
		} },
		variant: 'original',
		maximumOriginalBytes: 8_192,
		maximumPreviewBytes: 1_024,
		fetch: async () => new Response(Uint8Array.of(1, 2, 3), { headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': "attachment; filename*=UTF-8''%ZZinvalid",
		} }),
		url: ORIGINAL_URL,
	});

	assert.equal(download.mimeType, 'audio/flac');
	assert.equal(download.fileName, 'storm-.flac');
	assert.deepEqual(new Uint8Array(await download.blob.arrayBuffer()), Uint8Array.of(1, 2, 3));
	await assert.rejects(downloadFreesoundImport({
		sound: SOUND,
		variant: 'original',
		maximumOriginalBytes: 8_192,
		maximumPreviewBytes: 1_024,
		fetch: async () => new Response(Uint8Array.of(1), { headers: {
			'Content-Type': 'text/html',
		} }),
		url: ORIGINAL_URL,
	}), /not audio/u);
});
