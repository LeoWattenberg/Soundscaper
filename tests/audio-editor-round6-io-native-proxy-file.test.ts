/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { DESKTOP_READ_HARD_LIMIT_BYTES } from '../src/common/editor/desktop-read-materialization.ts';
import { createDesktopSelectedRangeBlob } from '../src/common/editor/desktop-selected-range-blob.ts';
import { canonicalMediaContentBlob, MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../src/common/editor/storage/media-content-digest.ts';
import { withFramescaperVideoProxyFile } from '../src/common/editor/ui/framescaper-video-proxy-file.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';

test('proxy materialization retains its old 512 MiB ceiling before requesting a selected range', async () => {
	const id = 'a'.repeat(64);
	let reads = 0;
	const file = createDesktopSelectedRangeBlob({
		id, name: 'large.webm', mimeType: 'video/webm', size: DESKTOP_READ_HARD_LIMIT_BYTES + 1,
		lastModified: 0, readProfile: 'selected-range-v1',
		url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/large.webm`,
	}, { fetch: async () => { reads += 1; throw new Error('No over-budget read is allowed.'); } });
	await assert.rejects(withFramescaperVideoProxyFile({
		withReadDescriptors: async (_descriptors, _options, consume) => await consume([file]),
	}, {}, undefined, () => undefined), /materialization maximum/u);
	assert.equal(reads, 0);
});

test('proxy materialization copies exact bounded native ranges into plain Blob bytes', async (context) => {
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 23).fill(0x41);
	const fixture = await nativeSidecarFixture('ranges.webm', bytes);
	context.after(fixture.close);
	const ranges: string[] = [];
	const service = createAudioEditorFileService({ bridge: fixture.bridge,
		fetch: async (url: string, init: RequestInit) => {
			ranges.push(new Headers(init.headers).get('Range') ?? '');
			return fixture.fetch(url, init);
		},
	});
	const descriptors = await service.chooseFiles({ purpose: 'video', multiple: false });
	const body = await withFramescaperVideoProxyFile(service, descriptors[0], undefined, (candidate) =>
		canonicalMediaContentBlob(candidate));
	assert.equal(body.size, bytes.byteLength);
	assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
	assert.deepEqual(ranges, [`bytes=0-${MEDIA_CONTENT_DIGEST_CHUNK_BYTES - 1}`,
		`bytes=${MEDIA_CONTENT_DIGEST_CHUNK_BYTES}-${bytes.byteLength - 1}`]);
	assert.equal(fixture.releases.length, 1);
});

test('a cancelled native proxy read releases its chosen capability and never calls the consumer', async (context) => {
	const fixture = await nativeSidecarFixture('cancelled.webm', new Uint8Array([1, 2, 3]));
	context.after(fixture.close);
	const service = createAudioEditorFileService({ bridge: fixture.bridge, fetch: fixture.fetch });
	const descriptors = await service.chooseFiles({ purpose: 'video', multiple: false });
	const abort = new AbortController();
	abort.abort();
	let consumed = false;
	await assert.rejects(withFramescaperVideoProxyFile(service, descriptors[0], abort.signal, () => {
		consumed = true;
	}), { name: 'AbortError' });
	assert.equal(consumed, false);
	assert.equal(fixture.releases.length, 1);
});
