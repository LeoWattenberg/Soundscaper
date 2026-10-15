/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAudiocomProxy } from '../desktop/audiocom-integration.ts';
import { parseUploadInput } from '../functions/api/audiocom/_shared/contracts.ts';
import { createAudiocomApiClient } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';

test('the browser client streams desktop audio and metadata through the proxy into the backend upload contract', async () => {
	let parsed: ReturnType<typeof parseUploadInput> | undefined;
	const proxy = createDesktopAudiocomProxy({
		appOrigin: 'soundscaper-app://bundle', apiOrigin: 'https://soundscaper.org',
		sessionStore: { get: () => 'a'.repeat(43), set: async () => {}, clear: async () => {} },
		fetchImpl: async (url, init) => {
			const request = new Request(url, init);
			parsed = parseUploadInput(request);
			assert.equal(request.headers.get('authorization'), `Bearer ${'a'.repeat(43)}`);
			assert.equal(await request.text(), 'RIFF');
			return Response.json({ data: { processing: true, audio: {
				id: '123', title: parsed.title, url: 'https://audio.com/user/audio/field-take',
				authorName: 'Recorder', username: 'user', description: parsed.description,
				license: parsed.license, isDownloadable: parsed.is_downloadable, durationSeconds: 1,
			} } }, { status: 201 });
		},
	});
	const client = createAudiocomApiClient({
		location: { origin: 'soundscaper-app://bundle', protocol: 'soundscaper-app:' },
		fetch: async (url, init) => proxy(new Request(url, init)),
	});
	const result = await client.upload(new File(['RIFF'], 'field take.wav', { type: 'audio/wav' }), {
		title: 'Garden rain', description: 'A field recording.', category: 'recording',
		license: 'cc-by', visibility: 'unlisted', downloadable: false, rightsConfirmed: true,
	});
	assert.deepEqual(parsed, {
		title: 'Garden rain', description: 'A field recording.', category: 'recording', license: 'cc-by',
		is_listed: false, is_downloadable: false, mime: 'audio/wav', name: 'field take.wav', size: 4,
	});
	assert.equal(result.processing, true);
	assert.equal(result.audio.url, 'https://audio.com/user/audio/field-take');
});
