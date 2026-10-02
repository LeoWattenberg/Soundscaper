/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	downloadFreesoundImport,
	FreesoundOriginalTooLargeError,
} from '../src/common/editor/controller/import/internal/freesound-import-download.ts';
import { FileSizeWarningRequiredError } from '../src/common/editor/controller/shared/file-size-warning.ts';

const SOUND = Object.freeze({
	id: 42,
	name: 'Rain close.ogg',
	preview: { available: true },
	originalFile: { byteLength: 4_096, format: 'ogg' },
});
const ORIGINAL_URL = new URL('https://soundscaper.org/api/freesound/sounds/42/original');

test('original size warnings settle before the authenticated download and permit the original', async () => {
	const calls: string[] = [];
	const download = await downloadFreesoundImport({
		sound: SOUND, variant: 'original', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
		url: ORIGINAL_URL,
		confirmFileSizeWarning: async (warning) => {
			calls.push('warning');
			assert.equal(warning.byteLength, SOUND.originalFile.byteLength);
			return true;
		},
		fetch: async (input) => {
			calls.push('fetch');
			assert.equal(new URL(String(input)).searchParams.get('sizeWarning'), 'client');
			return new Response(Uint8Array.of(1, 2, 3), { headers: { 'Content-Type': 'audio/ogg' } });
		},
	});
	assert.deepEqual(calls, ['warning', 'fetch']);
	assert.equal(download.blob.size, 3);
});

test('declined or stale original warnings fetch and read no audio', async () => {
	for (const stale of [false, true]) {
		let current = true;
		let fetched = false;
		await assert.rejects(downloadFreesoundImport({
			sound: SOUND, variant: 'original', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
			url: ORIGINAL_URL,
			assertCurrent: () => { if (!current) throw new Error('project changed'); },
			confirmFileSizeWarning: async () => { current = !stale; return stale; },
			fetch: async () => { fetched = true; return new Response(); },
		}), stale ? /project changed/u : { name: 'AbortError' });
		assert.equal(fetched, false);
	}
});

test('preview declared sizes warn before body reads and unknown streams warn once', async () => {
	for (const declared of [false, true]) {
		const calls: string[] = [];
		let remaining = 3;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				calls.push('read');
				if (remaining-- === 0) controller.close();
				else controller.enqueue(Uint8Array.of(1, 2, 3));
			},
		}, { highWaterMark: 0 });
		const result = await downloadFreesoundImport({
			sound: SOUND, variant: 'preview-hq-ogg', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
			url: ORIGINAL_URL,
			confirmFileSizeWarning: async (warning) => { calls.push('warning'); assert.ok(warning.byteLength > 4); return true; },
			fetch: async () => new Response(body, { headers: {
				'Content-Type': 'audio/ogg', ...(declared ? { 'Content-Length': '9' } : {}),
			} }),
		});
		assert.equal(result.blob.size, 9);
		assert.equal(calls.filter((call) => call === 'warning').length, 1);
		assert.equal(calls[0], declared ? 'warning' : 'read');
	}
});

test('preview cancellation before declared body reads and stale responses cancel the stream', async () => {
	let reads = 0;
	const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.close(); } }, { highWaterMark: 0 });
	await assert.rejects(downloadFreesoundImport({
		sound: SOUND, variant: 'preview-hq-ogg', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
		url: ORIGINAL_URL, confirmFileSizeWarning: async () => false,
		fetch: async () => new Response(body, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '9' } }),
	}), { name: 'AbortError' });
	assert.equal(reads, 0);
	await assert.rejects(downloadFreesoundImport({
		sound: SOUND, variant: 'original', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
		url: ORIGINAL_URL, fetch: async () => { throw new Error('must not fetch'); },
	}), FileSizeWarningRequiredError);
});

test('a project changed during fetch cancels unread Freesound audio', async () => {
	let current = true;
	let canceled = false;
	let reads = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) { reads++; controller.close(); }, cancel() { canceled = true; },
	}, { highWaterMark: 0 });
	await assert.rejects(downloadFreesoundImport({
		sound: SOUND, variant: 'preview-hq-ogg', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
		url: ORIGINAL_URL, assertCurrent: () => { if (!current) throw new Error('project changed'); },
		fetch: async () => { current = false; return new Response(body, { headers: { 'Content-Type': 'audio/ogg' } }); },
	}), /project changed/u);
	assert.equal(reads, 0);
	assert.equal(canceled, true);
});

test('malformed Freesound byte declarations are never admitted by an override', async () => {
	for (const length of ['-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1)]) {
		let warnings = 0;
		await assert.rejects(downloadFreesoundImport({
			sound: SOUND, variant: 'preview-hq-ogg', maximumOriginalBytes: 4, maximumPreviewBytes: 4,
			url: ORIGINAL_URL, confirmFileSizeWarning: async () => { warnings++; return true; },
			fetch: async () => new Response(null, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': length } }),
		}), /byte length/u);
		assert.equal(warnings, 0);
	}
});

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
